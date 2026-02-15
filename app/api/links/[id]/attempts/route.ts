import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const link = await prisma.link.findUnique({
    where: { id },
    select: { userId: true },
  })

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }

  if (link.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const attempts = await prisma.fetchAttempt.findMany({
    where: { linkId: id },
    select: {
      id: true,
      operationId: true,
      fetcherId: true,
      fetcherName: true,
      trigger: true,
      sequence: true,
      success: true,
      error: true,
      httpStatus: true,
      durationMs: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { sequence: "asc" }],
  })

  return NextResponse.json({ attempts })
}
