import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Get unique domains with counts, preferring finalDomain over domain
  const links = await prisma.link.findMany({
    where: {
      userId: session.user.id,
      fetchStatus: { not: "FAILED" },
    },
    select: {
      domain: true,
      finalDomain: true,
    },
  })

  // Count domains (prefer finalDomain if available)
  const domainCounts = new Map<string, number>()

  for (const link of links) {
    const domain = link.finalDomain || link.domain
    if (domain) {
      domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1)
    }
  }

  // Convert to sorted array
  const domains = Array.from(domainCounts.entries())
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count) // Sort by count descending

  return NextResponse.json({ domains })
}
