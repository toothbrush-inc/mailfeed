import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  const { id } = await params
  console.log("[/api/emails/[id]/ingest] Request started for email:", id)

  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Fetch the email
  const email = await prisma.email.findUnique({
    where: { id },
  })

  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 })
  }

  if (email.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  if (!email.rawContent) {
    return NextResponse.json({ error: "Email has no content to ingest" }, { status: 400 })
  }

  try {
    console.log("[/api/emails/[id]/ingest] Calling BAML IngestEmail...")
    const bamlStart = Date.now()

    const result = await b.IngestEmail(email.subject, email.rawContent)

    console.log("[/api/emails/[id]/ingest] BAML completed in", Date.now() - bamlStart, "ms")
    console.log("[/api/emails/[id]/ingest] Result:", JSON.stringify(result, null, 2))

    // BAML EmailTag string values match Prisma enum names exactly
    const prismaTags = result.tags as string[]

    // Update the email with tags
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updatedEmail = await prisma.email.update({
      where: { id },
      data: {
        tags: prismaTags as any,
        ingestedAt: new Date(),
      },
    })

    console.log("[/api/emails/[id]/ingest] Total time:", Date.now() - startTime, "ms")

    return NextResponse.json({
      success: true,
      email: {
        id: updatedEmail.id,
        tags: updatedEmail.tags,
        ingestedAt: updatedEmail.ingestedAt,
      },
      bamlResult: {
        // subject: email.subject,
        tags: result.tags,
        links: result.links,
      },
    })
  } catch (error) {
    console.error("[/api/emails/[id]/ingest] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ingestion failed" },
      { status: 500 }
    )
  }
}
