import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      lastSyncAt: true,
      syncPageToken: true,
    },
  })

  // Count total emails synced
  const emailCount = await prisma.email.count({
    where: { userId: session.user.id },
  })

  return NextResponse.json({
    hasSynced: emailCount > 0,
    emailCount,
    lastSyncAt: user?.lastSyncAt,
    hasMorePages: !!user?.syncPageToken,
  })
}
