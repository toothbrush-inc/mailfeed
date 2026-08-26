import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  generateEmbedding,
  prepareTextForEmbedding,
  formatEmbeddingForPgVector,
} from "@/lib/embeddings"
import { isPgVectorAvailable } from "@/lib/vector-search"
import { getUserSettings } from "@/lib/user-settings"
import { getUserAiKeys, missingGeminiKeyMessage, resolveGeminiKey } from "@/lib/user-keys"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const link = await prisma.link.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      title: true,
      contentText: true,
      description: true,
      aiSummary: true,
    },
  })

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }

  if (link.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const [settings, aiKeys] = await Promise.all([
    getUserSettings(session.user.id),
    getUserAiKeys(session.user.id),
  ])

  // Chat and embeddings run on Gemini regardless of the selected analysis
  // client, so gate on the Gemini key specifically.
  const geminiKey = resolveGeminiKey(aiKeys)
  if (!geminiKey) {
    return NextResponse.json(
      { error: missingGeminiKeyMessage("Embeddings"), code: "AI_NOT_CONFIGURED" },
      { status: 503 }
    )
  }

  const pgvectorAvailable = await isPgVectorAvailable()
  if (!pgvectorAvailable) {
    return NextResponse.json(
      { error: "pgvector extension not installed" },
      { status: 503 }
    )
  }

  const text = prepareTextForEmbedding(link)
  if (!text) {
    await prisma.link.update({
      where: { id },
      data: {
        embeddingStatus: "SKIPPED",
        embeddingError: "No content available for embedding",
      },
    })
    return NextResponse.json({
      success: false,
      error: "No content available for embedding",
    })
  }

  await prisma.link.update({
    where: { id },
    data: { embeddingStatus: "PROCESSING" },
  })

  try {
    const embedding = await generateEmbedding(text, "RETRIEVAL_DOCUMENT", settings, aiKeys)
    const embeddingStr = formatEmbeddingForPgVector(embedding)

    await prisma.$executeRaw`
      UPDATE "Link"
      SET embedding = ${embeddingStr}::vector,
          "embeddingStatus" = 'COMPLETED',
          "embeddedAt" = NOW(),
          "embeddingError" = NULL
      WHERE id = ${id}
    `

    return NextResponse.json({ success: true })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error"
    await prisma.link.update({
      where: { id },
      data: {
        embeddingStatus: "FAILED",
        embeddingError: errorMessage,
      },
    })
    return NextResponse.json(
      { success: false, error: errorMessage },
      { status: 500 }
    )
  }
}
