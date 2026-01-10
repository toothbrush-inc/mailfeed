import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

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
  const read = searchParams.get("read")
  const search = searchParams.get("search")
  const sort = searchParams.get("sort") || "date_desc"
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "20")

  // Build orderBy based on sort parameter
  // Use email.receivedAt for date sorting (when the email was received, not when link was processed)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let orderBy: any[]
  switch (sort) {
    case "date_asc":
      orderBy = [{ email: { receivedAt: "asc" } }, { createdAt: "asc" }]
      break
    case "reading_time_asc":
      orderBy = [{ readingTimeMin: "asc" }, { email: { receivedAt: "desc" } }]
      break
    case "reading_time_desc":
      orderBy = [{ readingTimeMin: "desc" }, { email: { receivedAt: "desc" } }]
      break
    case "date_desc":
    default:
      orderBy = [{ email: { receivedAt: "desc" } }, { createdAt: "desc" }]
      break
  }

  // Fetch user's hidden domains first (needed for query)
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hiddenDomains: true },
  })
  const hiddenDomains = user?.hiddenDomains || []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    userId: session.user.id,
    parentLinkId: null, // Only show top-level links, not nested/child links
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

  if (highlighted === "true") {
    where.isHighlighted = true
  }

  if (status) {
    where.fetchStatus = status
  }

  if (read === "read") {
    where.isRead = true
  } else if (read === "unread") {
    where.isRead = false
  }

  // Full-text search across multiple fields
  if (search && search.trim()) {
    const searchTerm = search.trim()
    andConditions.push({
      OR: [
        { title: { contains: searchTerm, mode: "insensitive" } },
        { url: { contains: searchTerm, mode: "insensitive" } },
        { finalUrl: { contains: searchTerm, mode: "insensitive" } },
        { aiSummary: { contains: searchTerm, mode: "insensitive" } },
        { contentText: { contains: searchTerm, mode: "insensitive" } },
        { domain: { contains: searchTerm, mode: "insensitive" } },
        { finalDomain: { contains: searchTerm, mode: "insensitive" } },
      ],
    })
  }

  // Exclude hidden domains (in database query for correct pagination)
  if (hiddenDomains.length > 0) {
    andConditions.push({
      AND: [
        { OR: [{ domain: null }, { domain: { notIn: hiddenDomains } }] },
        { OR: [{ finalDomain: null }, { finalDomain: { notIn: hiddenDomains } }] },
      ],
    })
  }

  // Note: System-excluded domains (EXCLUDED_DOMAINS) are filtered during sync,
  // not at query time, for performance reasons.

  // Apply AND conditions after all have been added
  if (andConditions.length > 0) {
    where.AND = andConditions
  }

  const queryStart = Date.now()
  const [links, total] = await Promise.all([
    prisma.link.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        email: {
          select: {
            gmailId: true,
            subject: true,
            receivedAt: true,
            rawContent: true,
          },
        },
        categories: {
          include: {
            category: true,
          },
        },
        childLinks: {
          select: {
            id: true,
            url: true,
            title: true,
            domain: true,
            finalUrl: true,
            finalDomain: true,
            aiSummary: true,
            aiKeyPoints: true,
            aiCategory: true,
            aiTags: true,
            linkTags: true,
            contentTags: true,
            metadataTags: true,
            fetchStatus: true,
            isHighlighted: true,
            highlightReason: true,
            isRead: true,
            readingTimeMin: true,
            imageUrl: true,
            isPaywalled: true,
            paywallType: true,
            contentSource: true,
            archivedUrl: true,
            wordCount: true,
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    }),
    prisma.link.count({ where }),
  ])

  console.log("[/api/links] DB query completed in", Date.now() - queryStart, "ms")
  console.log("[/api/links] Total request time:", Date.now() - startTime, "ms")
  console.log("[/api/links] Found", links.length, "links, total:", total)

  return NextResponse.json({
    links,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
