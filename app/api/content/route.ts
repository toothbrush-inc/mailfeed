import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "10")

  // Get user's hidden domains
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hiddenDomains: true },
  })
  const hiddenDomains = new Set(user?.hiddenDomains || [])

  // Fetch links that have content (contentText or rawHtml)
  const [allLinks, total] = await Promise.all([
    prisma.link.findMany({
      where: {
        userId: session.user.id,
        parentLinkId: null,
        OR: [
          { contentText: { not: null } },
          { rawHtml: { not: null } },
        ],
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit * 2, // Fetch extra to account for hidden domain filtering
      select: {
        id: true,
        url: true,
        finalUrl: true,
        domain: true,
        finalDomain: true,
        title: true,
        imageUrl: true,
        contentText: true,
        contentHtml: true,
        rawHtml: true,
        aiSummary: true,
        readingTimeMin: true,
        wordCount: true,
        isHighlighted: true,
        isRead: true,
        createdAt: true,
        email: {
          select: {
            receivedAt: true,
          },
        },
      },
    }),
    prisma.link.count({
      where: {
        userId: session.user.id,
        parentLinkId: null,
        OR: [
          { contentText: { not: null } },
          { rawHtml: { not: null } },
        ],
      },
    }),
  ])

  // Filter out hidden domains
  const filteredLinks = allLinks.filter((link) => {
    const domain = link.finalDomain || link.domain
    return !domain || !hiddenDomains.has(domain)
  })

  const links = filteredLinks.slice(0, limit)

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
