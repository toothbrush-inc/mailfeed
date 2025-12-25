import { auth } from "@/auth"

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const isOnDashboard = req.nextUrl.pathname.startsWith("/feed") ||
                        req.nextUrl.pathname.startsWith("/settings")
  const isOnLogin = req.nextUrl.pathname === "/login"
  const isApiRoute = req.nextUrl.pathname.startsWith("/api")
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth")

  // Allow auth API routes
  if (isAuthRoute) {
    return
  }

  // Protect API routes
  if (isApiRoute && !isLoggedIn) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Redirect to login if not authenticated and trying to access dashboard
  if (isOnDashboard && !isLoggedIn) {
    return Response.redirect(new URL("/login", req.nextUrl))
  }

  // Redirect to feed if already logged in and on login page
  if (isOnLogin && isLoggedIn) {
    return Response.redirect(new URL("/feed", req.nextUrl))
  }
})

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
}
