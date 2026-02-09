import type { NextAuthConfig } from "next-auth"
import Google from "next-auth/providers/google"

// Edge-compatible auth config (no database adapter)
export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || "insecure-default-secret-replace-me",
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/gmail.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isOnDashboard = nextUrl.pathname.startsWith("/feed") ||
                            nextUrl.pathname.startsWith("/settings")
      const isOnLogin = nextUrl.pathname === "/login"

      if (isOnDashboard && !isLoggedIn) {
        return false
      }

      if (isOnLogin && isLoggedIn) {
        return Response.redirect(new URL("/feed", nextUrl))
      }

      return true
    },
  },
}
