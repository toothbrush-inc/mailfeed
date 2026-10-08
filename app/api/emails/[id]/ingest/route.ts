import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"
import { hashUrl, extractDomain, cleanUrl } from "@/lib/link-extractor"
import { getUserSettings } from "@/lib/user-settings"
import { getUserAiKeys } from "@/lib/user-keys"
import { buildClientRegistry } from "@/lib/baml-registry"
import { withBamlUsage } from "@/lib/ai-usage"

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

  // Never load another user's row (decryption uses the row's DEK).
  const email = await prisma.email.findFirst({
    where: { id, userId: session.user.id },
  })

  if (!email) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 })
  }

  if (!email.rawContent) {
    return NextResponse.json({ error: "Email has no content to ingest" }, { status: 400 })
  }

  const [settings, aiKeys] = await Promise.all([
    getUserSettings(session.user.id),
    getUserAiKeys(session.user.id),
  ])

  try {
    console.log("[/api/emails/[id]/ingest] Calling BAML IngestEmail...")
    const bamlStart = Date.now()

    const clientRegistry = buildClientRegistry(settings, aiKeys)
    const rawContent = email.rawContent
    const result = await withBamlUsage({ userId: session.user.id, kind: "INGEST_EMAIL" }, (collector) =>
      b.IngestEmail(email.subject || "", rawContent, { clientRegistry, collector })
    )

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

    // Create Link records for extracted links
    const linksCreated: string[] = []
    for (const extractedLink of result.links) {
      // Stored without tracking parameters, like links found any other way
      const linkUrl = cleanUrl(extractedLink.url)
      const urlHash = hashUrl(linkUrl)

      // Check if link already exists for this user
      const existingLink = await prisma.link.findUnique({
        where: { userId_urlHash: { userId: session.user.id, urlHash } },
      })

      if (existingLink) {
        console.log(`[/api/emails/[id]/ingest] Link already exists: ${extractedLink.url}`)
        continue
      }

      // Create new link record
      await prisma.link.create({
        data: {
          userId: session.user.id,
          emailId: id,
          sharedAt: updatedEmail.receivedAt,
          url: linkUrl,
          urlHash,
          title: extractedLink.title || null,
          domain: extractDomain(linkUrl),
          fetchStatus: "PENDING",
        },
      })

      linksCreated.push(extractedLink.url)
      console.log(`[/api/emails/[id]/ingest] Created link: ${extractedLink.url}`)
    }

    // Fetch the updated email with links
    const emailWithLinks = await prisma.email.findFirst({
      where: { id, userId: session.user.id },
      include: {
        links: {
          where: { userId: session.user.id },
          select: {
            id: true,
            url: true,
            title: true,
            domain: true,
            aiSummary: true,
            aiCategory: true,
            aiTags: true,
            fetchStatus: true,
            isHighlighted: true,
          },
          orderBy: {
            createdAt: "asc",
          },
        },
      },
    })

    console.log("[/api/emails/[id]/ingest] Total time:", Date.now() - startTime, "ms")
    console.log(`[/api/emails/[id]/ingest] Created ${linksCreated.length} new links`)

    return NextResponse.json({
      success: true,
      email: {
        id: updatedEmail.id,
        tags: updatedEmail.tags,
        ingestedAt: updatedEmail.ingestedAt,
        links: emailWithLinks?.links || [],
      },
      linksCreated,
    })
  } catch (error) {
    console.error("[/api/emails/[id]/ingest] Error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Ingestion failed" },
      { status: 500 }
    )
  }
}
