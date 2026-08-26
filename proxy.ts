import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

export const proxy = NextAuth(authConfig).auth

export const config = {
  // API routes call auth() themselves. Running the NextAuth proxy on them
  // clones POST bodies and has caused 502s on routes like POST /api/domains.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|api/).*)"],
}
