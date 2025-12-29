import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

export const proxy = NextAuth(authConfig).auth

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$|api/auth).*)"],
}
