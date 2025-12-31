import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { EXCLUDED_DOMAINS } from "@/lib/link-extractor"

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  console.log("[/api/links] Request started")

  const authStart = Date.now()
  const session = await auth()
  console.log("[/api/links] Auth completed in", Date.now() - authStart, "ms")

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const category = searchParams.get("category")
  const tag = searchParams.get("tag")
  const domain = searchParams.get("domain")
  const highlighted = searchParams.get("highlighted")
  const status = searchParams.get("status")
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "20")

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    userId: session.user.id,
  }

  if (category) {
    where.aiCategory = category
  }

  // Build AND conditions for filters that need OR logic internally
  const andConditions: any[] = []

  if (tag) {
    // Search across all tag types
    andConditions.push({
      OR: [
        { linkTags: { has: tag } },
        { contentTags: { has: tag } },
        { metadataTags: { has: tag } },
        { aiTags: { has: tag } },
      ],
    })
  }

  if (domain) {
    // Filter by domain (check both original and final domain)
    andConditions.push({
      OR: [
        { domain: domain },
        { finalDomain: domain },
      ],
    })
  }

  if (andConditions.length > 0) {
    where.AND = andConditions
  }

  if (highlighted === "true") {
    where.isHighlighted = true
  }

  if (status) {
    where.fetchStatus = status
  }

  // Helper to check if a URL should be excluded
  const isExcludedUrl = (url: string) => {
    const lowerUrl = url.toLowerCase()
    return EXCLUDED_DOMAINS.some((d) => lowerUrl.includes(d))
  }

  const queryStart = Date.now()
  // Fetch more than needed to account for filtering
  const [allLinks, total] = await Promise.all([
    prisma.link.findMany({
      where,
      orderBy: [
        { isHighlighted: "desc" },
        { worthinessScore: "desc" },
        { createdAt: "desc" },
      ],
      skip: (page - 1) * limit,
      take: limit * 2, // Fetch extra to account for excluded domains
      include: {
        email: {
          select: {
            gmailId: true,
            subject: true,
            receivedAt: true,
          },
        },
        categories: {
          include: {
            category: true,
          },
        },
      },
    }),
    prisma.link.count({ where }),
  ])

  // Filter out excluded domains (check both original URL and final URL)
  const filteredLinks = allLinks.filter((link) => {
    // Check original URL
    if (isExcludedUrl(link.url)) return false
    // Check final URL if it exists
    if (link.finalUrl && isExcludedUrl(link.finalUrl)) return false
    return true
  })
  const links = filteredLinks.slice(0, limit)

  console.log("[/api/links] DB query completed in", Date.now() - queryStart, "ms")
  console.log("[/api/links] Total request time:", Date.now() - startTime, "ms")
  console.log("[/api/links] Filtered out", allLinks.length - filteredLinks.length, "excluded domains")

  return NextResponse.json({
    links,
    pagination: {
      page,
      limit,
      total: total - (allLinks.length - filteredLinks.length), // Approximate
      totalPages: Math.ceil(total / limit),
    },
  })
}
