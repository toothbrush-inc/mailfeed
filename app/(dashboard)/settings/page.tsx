import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmbeddingSection } from "@/components/settings/embedding-section"

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
          Manage your account and view statistics.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>Your account information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {session.user.image && (
              <img
                src={session.user.image}
                alt={session.user.name || "User"}
                className="h-16 w-16 rounded-full"
              />
            )}
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

      <Card>
        <CardHeader>
          <CardTitle>Statistics</CardTitle>
          <CardDescription>Overview of your feed data</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <p className="text-2xl font-bold">{user?._count.emails || 0}</p>
              <p className="text-sm text-muted-foreground">Emails processed</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <p className="text-2xl font-bold">{user?._count.links || 0}</p>
              <p className="text-sm text-muted-foreground">Links extracted</p>
            </div>
            {stats.map((stat: { fetchStatus: string; _count: number }) => (
              <div
                key={stat.fetchStatus}
                className="rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900"
              >
                <p className="text-2xl font-bold">{stat._count}</p>
                <p className="text-sm text-muted-foreground">
                  {stat.fetchStatus.toLowerCase().replace("_", " ")}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <EmbeddingSection />
    </div>
  )
}
