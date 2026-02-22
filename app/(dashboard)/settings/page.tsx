import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmbeddingSection } from "@/components/settings/embedding-section"
import { AiSettings } from "@/components/settings/ai-settings"
import { EmailSettings } from "@/components/settings/email-settings"
import { FetchingSettings } from "@/components/settings/fetching-settings"
import { AnalyzeSection } from "@/components/settings/analyze-section"
import { SyncSettings } from "@/components/settings/sync-settings"
import { FEATURE_FLAGS } from "@/lib/flags"
import { FeedSettings } from "@/components/settings/feed-settings"

export default async function SettingsPage() {
  const session = await auth()

  if (!session?.user?.id) {
    return null
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    include: {
      _count: {
        select: {
          emails: true,
          links: true,
        },
      },
    },
  })

  const stats = await prisma.link.groupBy({
    by: ["fetchStatus"],
    where: { userId: session.user.id },
    _count: true,
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-muted-foreground">
          Manage your account settings.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-200 text-2xl font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {(session.user.name || session.user.email || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="font-medium">{session.user.name}</p>
              <p className="text-sm text-muted-foreground">{session.user.email}</p>
            </div>
          </div>

          {user?.lastSyncAt && (
            <p className="text-sm text-muted-foreground">
              Last synced: {new Date(user.lastSyncAt).toLocaleString()}
            </p>
          )}
        </CardContent>
      </Card>

      
      <EmailSettings />
      <FetchingSettings />
      {FEATURE_FLAGS.enableAnalysis && <AnalyzeSection />}
      <SyncSettings />
      <FeedSettings />
      <AiSettings />
      <EmbeddingSection />
    </div>
  )
}
