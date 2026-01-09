import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { Header } from "@/components/layout/header"
import { Sidebar } from "@/components/layout/sidebar"
import { ChatButton } from "@/components/chat/chat-button"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const startTime = Date.now()
  console.log("[Dashboard Layout] Rendering started")

  const authStart = Date.now()
  const session = await auth()
  console.log("[Dashboard Layout] Auth completed in", Date.now() - authStart, "ms")

  if (!session) {
    redirect("/login")
  }

  console.log("[Dashboard Layout] Total server time:", Date.now() - startTime, "ms")

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Header user={session.user} />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 p-6">{children}</main>
      </div>
      <ChatButton />
    </div>
  )
}
