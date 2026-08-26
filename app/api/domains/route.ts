import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

async function requireUserId() {
  const session = await auth()
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }
  return { userId: session.user.id }
}

async function readDomain(request: NextRequest): Promise<string | NextResponse> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }
  const domain =
    typeof body === "object" && body !== null && "domain" in body
      ? (body as { domain: unknown }).domain
      : undefined
  if (!domain || typeof domain !== "string") {
    return NextResponse.json({ error: "Domain is required" }, { status: 400 })
  }
  return domain
}

async function updateHiddenDomains(
  userId: string,
  mutate: (hidden: Set<string>) => void
): Promise<string[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { hiddenDomains: true },
  })
  const hiddenDomains = new Set(user?.hiddenDomains || [])
  mutate(hiddenDomains)
  const next = Array.from(hiddenDomains)
  // select avoids returning dekWrapped/apiKeysEnc through the encryption
  // extension; set is the Prisma scalar-list write.
  await prisma.user.update({
    where: { id: userId },
    data: { hiddenDomains: { set: next } },
    select: { id: true },
  })
  return next
}

// GET: List all domains the user has encountered with link counts and hidden status
export async function GET() {
  const authz = await requireUserId()
  if ("error" in authz) return authz.error

  try {
    const [user, rows] = await Promise.all([
      prisma.user.findUnique({
        where: { id: authz.userId },
        select: { hiddenDomains: true },
      }),
      prisma.$queryRaw<Array<{ domain: string; count: number }>>`
        SELECT COALESCE("finalDomain", domain) AS domain, COUNT(*)::int AS count
        FROM "Link"
        WHERE "userId" = ${authz.userId}
          AND "fetchStatus" <> 'FAILED'
          AND COALESCE("finalDomain", domain) IS NOT NULL
        GROUP BY 1
        ORDER BY count DESC
      `,
    ])

    const hiddenDomains = user?.hiddenDomains || []
    const hidden = new Set(hiddenDomains)
    const domains = rows.map((row) => ({
      domain: row.domain,
      count: Number(row.count),
      isHidden: hidden.has(row.domain),
    }))

    return NextResponse.json({ domains, hiddenDomains })
  } catch (error) {
    console.error("[/api/domains] GET failed:", error)
    return NextResponse.json({ error: "Failed to list domains" }, { status: 500 })
  }
}

// POST: Hide a domain
export async function POST(request: NextRequest) {
  const authz = await requireUserId()
  if ("error" in authz) return authz.error

  const domain = await readDomain(request)
  if (domain instanceof NextResponse) return domain

  try {
    const hiddenDomains = await updateHiddenDomains(authz.userId, (hidden) => {
      hidden.add(domain)
    })
    return NextResponse.json({ success: true, hiddenDomains })
  } catch (error) {
    console.error("[/api/domains] POST failed:", error)
    return NextResponse.json({ error: "Failed to hide domain" }, { status: 500 })
  }
}

// DELETE: Unhide a domain
export async function DELETE(request: NextRequest) {
  const authz = await requireUserId()
  if ("error" in authz) return authz.error

  const domain = await readDomain(request)
  if (domain instanceof NextResponse) return domain

  try {
    const hiddenDomains = await updateHiddenDomains(authz.userId, (hidden) => {
      hidden.delete(domain)
    })
    return NextResponse.json({ success: true, hiddenDomains })
  } catch (error) {
    console.error("[/api/domains] DELETE failed:", error)
    return NextResponse.json({ error: "Failed to unhide domain" }, { status: 500 })
  }
}
