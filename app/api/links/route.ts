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
  const highlighted = searchParams.get("highlighted")
  const status = searchParams.get("status")
  const page = parseInt(searchParams.get("page") || "1")
  const limit = parseInt(searchParams.get("limit") || "20")

  const where: {
    userId: string
    aiCategory?: string
    aiTags?: { has: string }
    isHighlighted?: boolean
    fetchStatus?: string
  } = {
    userId: session.user.id,
  }

  if (category) {
    where.aiCategory = category
  }

  if (tag) {
    where.aiTags = { has: tag }
  }

  if (highlighted === "true") {
    where.isHighlighted = true
  }

  if (status) {
    where.fetchStatus = status
  }

  const queryStart = Date.now()
  const [links, total] = await Promise.all([
    prisma.link.findMany({
      where,
      orderBy: [
        { isHighlighted: "desc" },
        { worthinessScore: "desc" },
        { createdAt: "desc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
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
  console.log("[/api/links] DB query completed in", Date.now() - queryStart, "ms")
  console.log("[/api/links] Total request time:", Date.now() - startTime, "ms")

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
