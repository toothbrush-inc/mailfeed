import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { GoogleGenAI } from "@google/genai"
import { generateEmbedding } from "@/lib/embeddings"
import { searchSimilarContent, SimilarContent, textSearchLinks } from "@/lib/vector-search"
import { getUserSettings } from "@/lib/user-settings"
import { isAiConfigured, getMissingEnvVarMessage } from "@/lib/ai-provider"

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

  const settings = await getUserSettings(session.user.id)

  if (!isAiConfigured(settings)) {
    return NextResponse.json(
      { error: getMissingEnvVarMessage(settings), code: "AI_NOT_CONFIGURED" },
      { status: 503 }
    )
  }

  const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

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
      queryEmbedding = await generateEmbedding(searchTerm, "RETRIEVAL_QUERY", settings)
    } catch (error) {
      console.log("[/api/chat] Embedding generation failed, using text search:", error)
    }

    // Search for relevant content (both links and emails) using vector search
    let relevantContent: SimilarContent[] = []
    if (queryEmbedding) {
      try {
        relevantContent = await searchSimilarContent(
          session.user.id,
          queryEmbedding,
          10,
          0.3
        )
      } catch (error) {
        console.log("[/api/chat] Vector search failed, falling back to text search:", error)
      }
    }

    // If vector search didn't find anything, fall back to text search for links
    if (relevantContent.length === 0) {
      const textLinks = await textSearchLinks(session.user.id, searchTerm, 5)
      relevantContent = textLinks.map(link => ({ type: 'link' as const, ...link }))

      // Also search emails with text
      const textEmails = await prisma.email.findMany({
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
          snippet: true,
          receivedAt: true,
        },
        take: 5,
        orderBy: { receivedAt: "desc" },
      })

      relevantContent.push(...textEmails.map(email => ({
        type: 'email' as const,
        id: email.id,
        subject: email.subject,
        snippet: email.snippet,
        receivedAt: email.receivedAt,
        similarity: 0.5,
      })))
    }

    // Build context from the retrieved data
    let context = ""
    const sources: Source[] = []

    if (relevantContent.length > 0) {
      context += "## Relevant Content from your data:\n\n"

      for (const item of relevantContent) {
        if (item.type === 'link') {
          context += `### ${item.title || "Untitled"} (Link)\n`
          context += `URL: ${item.url}\n`
          if (item.aiSummary) context += `Summary: ${item.aiSummary}\n`
          if (item.aiKeyPoints?.length) context += `Key Points: ${item.aiKeyPoints.join("; ")}\n`
          if (item.contentText) {
            const truncatedContent = item.contentText.slice(0, 1500)
            context += `Content: ${truncatedContent}${item.contentText.length > 1500 ? "..." : ""}\n`
          }
          context += `Relevance: ${Math.round(item.similarity * 100)}%\n\n`
          sources.push({
            id: item.id,
            title: item.title || item.url,
            url: item.url,
            type: "link",
          })
        } else if (item.type === 'email') {
          context += `### ${item.subject || "No Subject"} (Email)\n`
          context += `Received: ${item.receivedAt.toISOString()}\n`
          if (item.snippet) {
            // Strip HTML tags for cleaner context
            const textContent = item.snippet
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim()
            context += `Content: ${textContent}\n`
          }
          context += `Relevance: ${Math.round(item.similarity * 100)}%\n\n`
          sources.push({
            id: item.id,
            title: item.subject || "No Subject",
            url: `/emails?id=${item.id}`,
            type: "email",
          })
        }
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
      model: settings.ai.chatModel,
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
