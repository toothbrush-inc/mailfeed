// Next.js server-start hook: boots the background auto-sync scheduler.
// No-op unless MAILFEED_AUTO_SYNC_INTERVAL_MINUTES is set.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { startAutoSync } = await import("@/lib/auto-sync")
  startAutoSync()
}
