import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Get days parameter (default 30, max 365, 0 = all time)
  const searchParams = request.nextUrl.searchParams
  const daysParam = searchParams.get("days")
  const days = daysParam ? parseInt(daysParam) : 30

  // Calculate start date
  let startDate: Date | null = null
  if (days > 0) {
    startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
  }

  const emails = await prisma.email.findMany({
    where: {
      userId: session.user.id,
      ...(startDate && { receivedAt: { gte: startDate } }),
    },
    select: {
      receivedAt: true,
    },
    orderBy: {
      receivedAt: "asc",
    },
  })

  // Group by day
  const dailyCounts = new Map<string, number>()

  // For fixed periods, initialize all days with 0
  // For "all time", only show days with data
  if (startDate) {
    for (let d = new Date(startDate); d <= new Date(); d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split("T")[0]
      dailyCounts.set(dateKey, 0)
    }
  }

  // Count emails per day
  for (const email of emails) {
    const dateKey = email.receivedAt.toISOString().split("T")[0]
    dailyCounts.set(dateKey, (dailyCounts.get(dateKey) || 0) + 1)
  }

  // Convert to array for chart
  const data = Array.from(dailyCounts.entries())
    .map(([date, count]) => ({
      date,
      count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  // Get total count
  const totalEmails = await prisma.email.count({
    where: { userId: session.user.id },
  })

  // Get first email date for "all time" reference
  const firstEmail = await prisma.email.findFirst({
    where: { userId: session.user.id },
    orderBy: { receivedAt: "asc" },
    select: { receivedAt: true },
  })

  return NextResponse.json({
    daily: data,
    total: totalEmails,
    periodTotal: data.reduce((sum, d) => sum + d.count, 0),
    periodStart: startDate?.toISOString() || firstEmail?.receivedAt.toISOString() || new Date().toISOString(),
    periodEnd: new Date().toISOString(),
    days,
  })
}
