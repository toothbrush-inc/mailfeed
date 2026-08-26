import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { findEmailIdsMatchingText } from "@/lib/email-search"

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  console.log("[/api/emails] Request started")

  const authStart = Date.now()
  const session = await auth()
  console.log("[/api/emails] Auth completed in", Date.now() - authStart, "ms")

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "20")
  const tag = searchParams.get("tag")
  const search = searchParams.get("search")

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    userId: session.user.id,
  }

  if (tag) {
    where.tags = { has: tag }
  }

  if (search) {
    // subject/snippet/rawContent are encrypted at rest, so the database
    // cannot substring-match them. Decrypt-and-filter email bodies; link
    // fields stay SQL-searchable. O(user's mailbox), fine at personal scale.
    const [linkMatches, emailIds] = await Promise.all([
      prisma.link.findMany({
        where: {
          userId: session.user.id,
          emailId: { not: null },
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { aiSummary: { contains: search, mode: "insensitive" } },
            { aiCategory: { contains: search, mode: "insensitive" } },
          ],
        },
        select: { emailId: true },
      }),
      findEmailIdsMatchingText(session.user.id, search),
    ])
    const matchedIds = new Set(emailIds)
    for (const match of linkMatches) {
      if (match.emailId) matchedIds.add(match.emailId)
    }
    where.id = { in: Array.from(matchedIds) }
  }

  const queryStart = Date.now()
  const [emails, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: {
        receivedAt: "desc",
      },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        links: {
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
    }),
    prisma.email.count({ where }),
  ])
  console.log("[/api/emails] DB query completed in", Date.now() - queryStart, "ms")
  console.log("[/api/emails] Total request time:", Date.now() - startTime, "ms")

  return NextResponse.json({
    emails,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
