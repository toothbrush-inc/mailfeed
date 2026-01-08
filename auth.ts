import NextAuth from "next-auth"
import { PrismaAdapter } from "@auth/prisma-adapter"
import { prisma } from "@/lib/prisma"
import { authConfig } from "@/auth.config"

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id
      }
      if (account) {
        token.accessToken = account.access_token
        console.log("[Auth] JWT callback - account present:", {
          provider: account.provider,
          hasAccessToken: !!account.access_token,
          hasRefreshToken: !!account.refresh_token,
        })
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.id as string
      return session
    },
  },
  events: {
    async linkAccount({ user, account }) {
      console.log("[Auth] Account linked:", {
        userId: user.id,
        provider: account.provider,
        hasAccessToken: !!account.access_token,
        hasRefreshToken: !!account.refresh_token,
        expiresAt: account.expires_at,
      })
    },
    async signIn({ user, account, isNewUser }) {
      console.log("[Auth] Sign in:", {
        userId: user.id,
        provider: account?.provider,
        isNewUser,
        hasAccessToken: !!account?.access_token,
        hasRefreshToken: !!account?.refresh_token,
      })

      // If this is a re-authentication (not new user), update the existing account tokens
      if (!isNewUser && account && user.id) {
        try {
          const existingAccount = await prisma.account.findFirst({
            where: {
              userId: user.id,
              provider: account.provider,
            },
          })

          if (existingAccount) {
            // Update tokens on existing account
            await prisma.account.update({
              where: { id: existingAccount.id },
              data: {
                access_token: account.access_token,
                refresh_token: account.refresh_token,
                expires_at: account.expires_at,
                token_type: account.token_type,
                scope: account.scope,
                id_token: account.id_token,
              },
            })
            console.log("[Auth] Updated existing account tokens for user:", user.id)
          }
        } catch (error) {
          console.error("[Auth] Failed to update account tokens:", error)
        }
      }
    },
  },
})

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
