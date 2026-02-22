import { Suspense } from "react"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmailActivityChart } from "@/components/feed/email-activity-chart"
import {
  Globe,
  Archive,
  FileText,
  Brain,
  Link2,
} from "lucide-react"
import { FEATURE_FLAGS } from "@/lib/flags"

export default async function StatsPage() {
  const session = await auth()

  if (!session?.user?.id) {
    return null
  }

  const userId = session.user.id

  // Fetch all stats in parallel
  const [
    totalLinks,
    fetchedDirect,
    fetchedWayback,
    withGoodContent,
    analyzed,
    withNestedLinks,
    embedded,
    fetchStatusStats,
    totalEmails,
  ] = await Promise.all([
    // Total links (excluding nested)
    prisma.link.count({
      where: { userId, parentLinkId: null },
    }),

    // Fetched directly (contentSource is null or "direct")
    prisma.link.count({
      where: {
        userId,
        parentLinkId: null,
        OR: [
          { contentSource: null },
          { contentSource: "direct" },
        ],
        fetchStatus: { in: ["FETCHED", "ANALYZING", "COMPLETED"] },
      },
    }),

    // Fetched via Wayback Machine
    prisma.link.count({
      where: {
        userId,
        parentLinkId: null,
        contentSource: "wayback",
      },
    }),

    // Links with good readability content (contentText with > 100 words)
    prisma.link.count({
      where: {
        userId,
        parentLinkId: null,
        contentText: { not: null },
        wordCount: { gte: 100 },
      },
    }),

    // Analyzed links (COMPLETED status or has aiSummary)
    prisma.link.count({
      where: {
        userId,
        parentLinkId: null,
        OR: [
          { fetchStatus: "COMPLETED" },
          { aiSummary: { not: null } },
        ],
      },
    }),

    // Links with nested/child links
    prisma.link.count({
      where: {
        userId,
        parentLinkId: null,
        childLinks: { some: {} },
      },
    }),

    // Embedded links
    prisma.link.count({
      where: {
        userId,
        parentLinkId: null,
        embeddingStatus: "COMPLETED",
      },
    }),

    // Fetch status breakdown
    prisma.link.groupBy({
      by: ["fetchStatus"],
      where: { userId, parentLinkId: null },
      _count: true,
    }),

    // Total emails
    prisma.email.count({
      where: { userId },
    }),
  ])

  // Calculate derived stats
  const pending = fetchStatusStats.find(s => s.fetchStatus === "PENDING")?._count || 0
  const fetching = fetchStatusStats.find(s => s.fetchStatus === "FETCHING")?._count || 0
  const fetched = fetchStatusStats.find(s => s.fetchStatus === "FETCHED")?._count || 0
  const analyzing = fetchStatusStats.find(s => s.fetchStatus === "ANALYZING")?._count || 0
  const completed = fetchStatusStats.find(s => s.fetchStatus === "COMPLETED")?._count || 0
  const failed = fetchStatusStats.find(s => s.fetchStatus === "FAILED")?._count || 0
  const paywalled = fetchStatusStats.find(s => s.fetchStatus === "PAYWALL_DETECTED")?._count || 0

  const fetchedTotal = fetched + analyzing + completed
  const inProgress = pending + fetching

  // Count nested links
  const nestedLinksCount = await prisma.link.count({
    where: { userId, parentLinkId: { not: null } },
  })

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Link Statistics</h2>
        <p className="text-muted-foreground">
          Detailed breakdown of your link collection and processing status.
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Links</CardTitle>
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalLinks}</div>
            <p className="text-xs text-muted-foreground">
              +{nestedLinksCount} nested links
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Emails Processed</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalEmails}</div>
            <p className="text-xs text-muted-foreground">
              {totalLinks > 0 ? (totalLinks / totalEmails).toFixed(1) : 0} links/email avg
            </p>
          </CardContent>
        </Card>

        {FEATURE_FLAGS.enableAnalysis && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Analyzed</CardTitle>
              <Brain className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{analyzed}</div>
              <p className="text-xs text-muted-foreground">
                {totalLinks > 0 ? ((analyzed / totalLinks) * 100).toFixed(0) : 0}% of links
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">With Nested Links</CardTitle>
            <Link2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{withNestedLinks}</div>
            <p className="text-xs text-muted-foreground">
              {nestedLinksCount} total nested
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Email Activity Chart */}
      <Suspense fallback={null}>
        <EmailActivityChart />
      </Suspense>

      {/* Content Source Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Content Sources</CardTitle>
          <CardDescription>Where link content was fetched from</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <Globe className="h-8 w-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{fetchedDirect}</p>
                <p className="text-sm text-muted-foreground">Fetched Directly</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <Archive className="h-8 w-8 text-amber-500" />
              <div>
                <p className="text-2xl font-bold">{fetchedWayback}</p>
                <p className="text-sm text-muted-foreground">From Wayback Machine</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <FileText className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold">{withGoodContent}</p>
                <p className="text-sm text-muted-foreground">Good Readability (&gt;100 words)</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Funnel */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Funnel</CardTitle>
          <CardDescription>Link processing stages as a percentage of total links</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(
            [
              { label: "Fetched", count: fetchedTotal, color: "bg-blue-500" },
              { label: "Good Readability", count: withGoodContent, color: "bg-green-500", indent: true },
              { label: "Embedded", count: embedded, color: "bg-indigo-500", indent: true },
              ...(FEATURE_FLAGS.enableAnalysis ? [{ label: "AI Analyzed", count: analyzed, color: "bg-purple-500", indent: true }] : []),
              { label: "Failed", count: failed, color: "bg-red-500" },
              { label: "Paywall", count: paywalled, color: "bg-amber-500" },
              { label: "Pending / Fetching", count: inProgress, color: "bg-zinc-400" },
            ] as { label: string; count: number; color: string; indent?: boolean }[]
          ).map(({ label, count, color, indent }) => {
            const pct = totalLinks > 0 ? (count / totalLinks) * 100 : 0
            return (
              <div key={label} className="flex items-center gap-3">
                {indent && <div className="w-4 shrink-0" />}
                <span className="text-sm text-muted-foreground w-36 shrink-0">{label}</span>
                <span className="text-sm font-medium w-14 text-right shrink-0">{count.toLocaleString()}</span>
                <span className="text-xs text-muted-foreground w-9 text-right shrink-0">{pct.toFixed(0)}%</span>
                <div className="flex-1 h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
