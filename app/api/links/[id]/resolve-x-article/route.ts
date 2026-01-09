import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import {
  parseXArticleUrl,
  resolveXArticleUrl,
  buildXArticleUrl,
  needsXArticleResolution,
  resolveXArticleFromParent,
} from "@/lib/x-article-resolver"
import { fetchAndParseContent } from "@/lib/content-fetcher"
import { hashUrl } from "@/lib/link-extractor"

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
    include: {
      parentLink: {
        select: {
          url: true,
          finalUrl: true,
        },
      },
    },
  })

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }

  if (link.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  // Check if this is an X article URL that needs resolution
  if (!needsXArticleResolution(link.url)) {
    return NextResponse.json({
      error: "This link is not an X article URL that needs resolution",
    }, { status: 400 })
  }

  const body = await request.json().catch(() => ({}))
  const { username, refetch = true } = body as { username?: string; refetch?: boolean }

  let resolvedUrl: string | null = null
  let resolvedUsername: string | null = null

  // If username provided, use it directly
  if (username) {
    const parsed = parseXArticleUrl(link.url)
    if (parsed.articleId) {
      resolvedUrl = buildXArticleUrl(parsed.articleId, username)
      resolvedUsername = username.replace(/^@/, '')
    }
  } else {
    // Try to resolve from parent link first (most reliable for nested links from tweets)
    if (link.parentLink) {
      const parentUrl = link.parentLink.finalUrl || link.parentLink.url
      const fromParent = resolveXArticleFromParent(link.url, parentUrl)
      if (fromParent) {
        resolvedUrl = fromParent
        // Extract username from resolved URL
        const match = fromParent.match(/x\.com\/([^/]+)\/article/)
        resolvedUsername = match ? match[1] : null
        console.log(`[X Article Resolver] Resolved from parent: ${link.url} -> ${fromParent}`)
      }
    }

    // If not resolved from parent, try automatic resolution via HTTP
    if (!resolvedUrl) {
      const resolved = await resolveXArticleUrl(link.url)
      if (resolved.success && resolved.canonicalUrl) {
        resolvedUrl = resolved.canonicalUrl
        resolvedUsername = resolved.username
      } else {
        return NextResponse.json({
          error: resolved.error || "Could not automatically resolve URL. Please provide a username.",
          needsUsername: true,
          articleId: resolved.articleId,
        }, { status: 422 })
      }
    }
  }

  if (!resolvedUrl) {
    return NextResponse.json({
      error: "Could not resolve URL",
      needsUsername: true,
    }, { status: 422 })
  }

  // Update the link with the resolved URL
  const updateData: Record<string, unknown> = {
    finalUrl: resolvedUrl,
    finalUrlHash: hashUrl(resolvedUrl),
    wasRedirected: true,
  }

  // Optionally refetch content with the new URL
  if (refetch) {
    try {
      const content = await fetchAndParseContent(resolvedUrl)

      if (content.success) {
        Object.assign(updateData, {
          title: content.title || link.title,
          description: content.excerpt || link.description,
          contentText: content.textContent,
          contentHtml: content.content,
          rawHtml: content.rawHtml,
          imageUrl: content.imageUrl,
          wordCount: content.wordCount,
          readingTimeMin: content.wordCount ? Math.ceil(content.wordCount / 200) : null,
          fetchStatus: "FETCHED",
          fetchedAt: new Date(),
          contentSource: "direct",
        })
      }
    } catch (error) {
      console.error("[X Article Resolver] Failed to fetch content:", error)
      // Still update the URL even if fetch fails
    }
  }

  const updatedLink = await prisma.link.update({
    where: { id },
    data: updateData,
  })

  return NextResponse.json({
    success: true,
    link: updatedLink,
    resolvedUrl,
    resolvedUsername,
  })
}

// GET endpoint to check if a link needs X article resolution
export async function GET(
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
    select: { url: true, userId: true },
  })

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }

  if (link.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const parsed = parseXArticleUrl(link.url)

  return NextResponse.json({
    needsResolution: parsed.needsUsername,
    articleId: parsed.articleId,
    originalUrl: link.url,
  })
}
