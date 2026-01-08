import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { google } from "googleapis"

// Debug endpoint to check token status (development only)
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 403 })
  }

  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not logged in", session: null }, { status: 401 })
  }

  const accounts = await prisma.account.findMany({
    where: { userId: session.user.id },
    select: {
      id: true,
      provider: true,
      providerAccountId: true,
      type: true,
      access_token: true,
      refresh_token: true,
      expires_at: true,
      token_type: true,
      scope: true,
    },
  })

  // Test the token if we have a Google account
  let tokenTest = null
  const googleAccount = accounts.find(a => a.provider === "google")
  if (googleAccount?.access_token) {
    try {
      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET
      )
      oauth2Client.setCredentials({
        access_token: googleAccount.access_token,
        refresh_token: googleAccount.refresh_token,
      })

      // Try to get user profile as a test
      const gmail = google.gmail({ version: "v1", auth: oauth2Client })
      const profile = await gmail.users.getProfile({ userId: "me" })
      tokenTest = {
        success: true,
        email: profile.data.emailAddress,
        messagesTotal: profile.data.messagesTotal,
      }
    } catch (error) {
      tokenTest = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        errorCode: (error as { code?: string | number })?.code,
        errorStatus: (error as { status?: number })?.status,
      }
    }
  }

  // Mask tokens for safety but show if they exist
  const maskedAccounts = accounts.map((acc) => ({
    ...acc,
    access_token: acc.access_token ? `${acc.access_token.slice(0, 20)}...` : null,
    refresh_token: acc.refresh_token ? `${acc.refresh_token.slice(0, 20)}...` : null,
    has_access_token: !!acc.access_token,
    has_refresh_token: !!acc.refresh_token,
    access_token_length: acc.access_token?.length || 0,
    refresh_token_length: acc.refresh_token?.length || 0,
    expires_at_date: acc.expires_at ? new Date(acc.expires_at * 1000).toISOString() : null,
    is_expired: acc.expires_at ? acc.expires_at * 1000 < Date.now() : null,
    seconds_until_expiry: acc.expires_at ? Math.floor((acc.expires_at * 1000 - Date.now()) / 1000) : null,
  }))

  return NextResponse.json({
    user: {
      id: session.user.id,
      email: session.user.email,
    },
    accounts: maskedAccounts,
    accountCount: accounts.length,
    tokenTest,
    timestamp: new Date().toISOString(),
  })
}
