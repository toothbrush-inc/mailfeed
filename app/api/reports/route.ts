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
  const limit = parseInt(searchParams.get("limit") || "20")

  // Only the caller's own reports on their own links; there is no admin
  // role, so a report is never visible to another mailbox.
  const where = {
    userId: session.user.id,
    link: { userId: session.user.id },
  }

  // Fetch reports with link and user details
  const [reports, total] = await Promise.all([
    prisma.linkReport.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        link: {
          select: {
            id: true,
            url: true,
            finalUrl: true,
            domain: true,
            finalDomain: true,
            title: true,
            fetchStatus: true,
            fetchError: true,
            contentSource: true,
            isPaywalled: true,
            paywallType: true,
            createdAt: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    }),
    prisma.linkReport.count({ where }),
  ])

  return NextResponse.json({
    reports,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
