import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  // Get all counts in parallel
  const [
    totalLinks,
    highlightedLinks,
    totalEmails,
    linksWithContent,
    domainsData,
    user,
  ] = await Promise.all([
    prisma.link.count({
      where: { userId, parentLinkId: null },
    }),
    prisma.link.count({
      where: { userId, parentLinkId: null, isHighlighted: true },
    }),
    prisma.email.count({
      where: { userId },
    }),
    // Count links with readable content
    prisma.link.count({
      where: {
        userId,
        parentLinkId: null,
        OR: [
          { contentText: { not: null } },
          { rawHtml: { not: null } },
        ],
      },
    }),
    // Get unique domains count
    prisma.link.findMany({
      where: { userId },
      select: { domain: true, finalDomain: true },
      distinct: ["finalDomain", "domain"],
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { hiddenDomains: true },
    }),
  ])

  // Count unique visible domains
  const hiddenDomains = new Set(user?.hiddenDomains || [])
  const uniqueDomains = new Set<string>()
  for (const link of domainsData) {
    const domain = link.finalDomain || link.domain
    if (domain && !hiddenDomains.has(domain)) {
      uniqueDomains.add(domain)
    }
  }

  return NextResponse.json({
    links: totalLinks,
    highlighted: highlightedLinks,
    emails: totalEmails,
    domains: uniqueDomains.size,
    withContent: linksWithContent,
  })
}
