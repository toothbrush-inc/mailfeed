import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

// Clear OAuth tokens for the current user to force re-authentication
export async function POST() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    // First, check existing accounts
    const existingAccounts = await prisma.account.findMany({
      where: {
        userId: session.user.id,
        provider: "google",
      },
      select: {
        id: true,
        providerAccountId: true,
        access_token: true,
        refresh_token: true,
      },
    })

    console.log(`[Auth] Found ${existingAccounts.length} Google account(s) for user ${session.user.id}:`,
      existingAccounts.map(a => ({
        id: a.id,
        providerAccountId: a.providerAccountId?.slice(0, 10) + "...",
        hasAccessToken: !!a.access_token,
        hasRefreshToken: !!a.refresh_token,
      }))
    )

    // Delete the Google account connection (tokens)
    const deleted = await prisma.account.deleteMany({
      where: {
        userId: session.user.id,
        provider: "google",
      },
    })

    console.log(`[Auth] Cleared ${deleted.count} Google account(s) for user ${session.user.id}`)

    // Verify deletion
    const remainingAccounts = await prisma.account.count({
      where: {
        userId: session.user.id,
        provider: "google",
      },
    })

    console.log(`[Auth] Remaining Google accounts after deletion: ${remainingAccounts}`)

    return NextResponse.json({
      success: true,
      deletedCount: deleted.count,
      message: "Tokens cleared. Please sign in again."
    })
  } catch (error) {
    console.error("[Auth] Failed to clear tokens:", error)
    return NextResponse.json(
      { error: "Failed to clear tokens" },
      { status: 500 }
    )
  }
}
