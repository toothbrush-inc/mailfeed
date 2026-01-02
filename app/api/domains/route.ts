import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// GET: List all domains the user has encountered with link counts and hidden status
export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Get user's hidden domains
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hiddenDomains: true },
  })

  const hiddenDomains = new Set(user?.hiddenDomains || [])

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

  // Convert to sorted array with hidden status
  const domains = Array.from(domainCounts.entries())
    .map(([domain, count]) => ({
      domain,
      count,
      isHidden: hiddenDomains.has(domain),
    }))
    .sort((a, b) => b.count - a.count) // Sort by count descending

  return NextResponse.json({ domains, hiddenDomains: Array.from(hiddenDomains) })
}

// POST: Hide a domain
export async function POST(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { domain } = body

  if (!domain || typeof domain !== "string") {
    return NextResponse.json({ error: "Domain is required" }, { status: 400 })
  }

  // Get current hidden domains
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hiddenDomains: true },
  })

  const hiddenDomains = new Set(user?.hiddenDomains || [])

  // Add domain if not already hidden
  if (!hiddenDomains.has(domain)) {
    hiddenDomains.add(domain)

    await prisma.user.update({
      where: { id: session.user.id },
      data: { hiddenDomains: Array.from(hiddenDomains) },
    })
  }

  return NextResponse.json({ success: true, hiddenDomains: Array.from(hiddenDomains) })
}

// DELETE: Unhide a domain
export async function DELETE(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const { domain } = body

  if (!domain || typeof domain !== "string") {
    return NextResponse.json({ error: "Domain is required" }, { status: 400 })
  }

  // Get current hidden domains
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { hiddenDomains: true },
  })

  const hiddenDomains = new Set(user?.hiddenDomains || [])

  // Remove domain if hidden
  if (hiddenDomains.has(domain)) {
    hiddenDomains.delete(domain)

    await prisma.user.update({
      where: { id: session.user.id },
      data: { hiddenDomains: Array.from(hiddenDomains) },
    })
  }

  return NextResponse.json({ success: true, hiddenDomains: Array.from(hiddenDomains) })
}
