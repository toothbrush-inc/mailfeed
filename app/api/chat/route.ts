import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GoogleGenAI } from "@google/genai"
import { generateEmbedding } from "@/lib/embeddings"
import { searchLinks, SimilarLink } from "@/lib/vector-search"

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

interface ChatMessage {
  role: "user" | "assistant"
  content: string
}

interface ChatRequest {
  message: string
  conversationHistory?: ChatMessage[]
}

interface Source {
  id: string
  title: string
  url: string
  type: "link" | "email"
}

export async function POST(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body: ChatRequest = await request.json()
    const { message, conversationHistory = [] } = body

    if (!message?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 })
    }

    // Search for relevant content in user's data
    const searchTerm = message.trim()

    // Try to generate query embedding for semantic search
    let queryEmbedding: number[] | null = null
    try {
      queryEmbedding = await generateEmbedding(searchTerm, "RETRIEVAL_QUERY")
    } catch (error) {
      console.log("[/api/chat] Embedding generation failed, using text search:", error)
    }

    // Search for relevant links using vector search with text fallback
    const relevantLinks: SimilarLink[] = await searchLinks(
      session.user.id,
      queryEmbedding,
      searchTerm,
      10,
      0.3
    )

    // Fetch relevant emails
    const relevantEmails = await prisma.email.findMany({
      where: {
        userId: session.user.id,
        OR: [
          { subject: { contains: searchTerm, mode: "insensitive" } },
          { rawContent: { contains: searchTerm, mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        subject: true,
        rawContent: true,
        receivedAt: true,
      },
      take: 5,
      orderBy: { receivedAt: "desc" },
    })

    // Build context from the retrieved data
    let context = ""
    const sources: Source[] = []

    if (relevantLinks.length > 0) {
      context += "## Relevant Links from your reading feed:\n\n"
      for (const link of relevantLinks) {
        context += `### ${link.title || "Untitled"}\n`
        context += `URL: ${link.url}\n`
        if (link.aiSummary) context += `Summary: ${link.aiSummary}\n`
        if (link.aiKeyPoints?.length) context += `Key Points: ${link.aiKeyPoints.join("; ")}\n`
        if (link.contentText) {
          const truncatedContent = link.contentText.slice(0, 1500)
          context += `Content: ${truncatedContent}${link.contentText.length > 1500 ? "..." : ""}\n`
        }
        context += "\n"
        sources.push({
          id: link.id,
          title: link.title || link.url,
          url: link.url,
          type: "link",
        })
      }
    }

    if (relevantEmails.length > 0) {
      context += "## Relevant Emails:\n\n"
      for (const email of relevantEmails) {
        context += `### ${email.subject || "No Subject"}\n`
        context += `Received: ${email.receivedAt.toISOString()}\n`
        if (email.rawContent) {
          // Strip HTML tags for cleaner context
          const textContent = email.rawContent
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 1000)
          context += `Content: ${textContent}${email.rawContent.length > 1000 ? "..." : ""}\n`
        }
        context += "\n"
        sources.push({
          id: email.id,
          title: email.subject || "No Subject",
          url: `email:${email.id}`,
          type: "email",
        })
      }
    }

    // If no relevant content found, still provide a helpful response
    if (!context) {
      context = "No directly relevant content was found in your saved links and emails for this query."
    }

    // Build the chat prompt
    const systemPrompt = `You are a helpful AI assistant with access to the user's saved reading feed and emails.
Your job is to answer questions based on the content they have saved.

Guidelines:
- Base your answers on the provided context when available
- If referencing specific articles or emails, mention their titles
- If the context doesn't contain relevant information, say so honestly
- Be concise but thorough
- If asked about topics not in the context, you can provide general knowledge but note that it's not from their saved content

${context ? `Here is the relevant content from the user's data:\n\n${context}` : ""}`

    // Build conversation for Gemini
    const conversationContent = [
      { role: "user" as const, parts: [{ text: systemPrompt }] },
      { role: "model" as const, parts: [{ text: "I understand. I'll help answer questions based on your saved content. What would you like to know?" }] },
      ...conversationHistory.flatMap((msg) => [
        { role: msg.role === "user" ? "user" as const : "model" as const, parts: [{ text: msg.content }] },
      ]),
      { role: "user" as const, parts: [{ text: message }] },
    ]

    // Call Gemini
    const response = await genAI.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: conversationContent,
    })

    const responseText = response.text || "I'm sorry, I couldn't generate a response."

    return NextResponse.json({
      response: responseText,
      sources: sources.length > 0 ? sources : undefined,
    })
  } catch (error) {
    console.error("[/api/chat] Error:", error)
    return NextResponse.json(
      { error: "Failed to process chat request" },
      { status: 500 }
    )
  }
}
