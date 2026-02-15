import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attemptId: string }> }
) {
  const { id, attemptId } = await params
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

  const attempt = await prisma.fetchAttempt.findUnique({
    where: { id: attemptId },
  })

  if (!attempt || attempt.linkId !== id) {
    return NextResponse.json({ error: "Attempt not found" }, { status: 404 })
  }

  return NextResponse.json({ attempt })
}
