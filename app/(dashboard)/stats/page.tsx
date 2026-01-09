import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Globe,
  Archive,
  FileText,
  Brain,
  Link2,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle
} from "lucide-react"

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
    fetchStatusStats,
    paywallStats,
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

    // Fetch status breakdown
    prisma.link.groupBy({
      by: ["fetchStatus"],
      where: { userId, parentLinkId: null },
      _count: true,
    }),

    // Paywall stats
    prisma.link.groupBy({
      by: ["isPaywalled"],
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

  const paywallCount = paywallStats.find(s => s.isPaywalled)?._count || 0

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

      {/* Fetch Status Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Processing Status</CardTitle>
          <CardDescription>Link fetch and analysis pipeline status</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <Clock className="h-6 w-6 text-zinc-400" />
              <div>
                <p className="text-xl font-bold">{pending}</p>
                <p className="text-sm text-muted-foreground">Pending</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <Clock className="h-6 w-6 text-blue-400 animate-pulse" />
              <div>
                <p className="text-xl font-bold">{fetching}</p>
                <p className="text-sm text-muted-foreground">Fetching</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <CheckCircle className="h-6 w-6 text-blue-500" />
              <div>
                <p className="text-xl font-bold">{fetched}</p>
                <p className="text-sm text-muted-foreground">Fetched</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <Brain className="h-6 w-6 text-purple-500 animate-pulse" />
              <div>
                <p className="text-xl font-bold">{analyzing}</p>
                <p className="text-sm text-muted-foreground">Analyzing</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <CheckCircle className="h-6 w-6 text-green-500" />
              <div>
                <p className="text-xl font-bold">{completed}</p>
                <p className="text-sm text-muted-foreground">Completed</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <XCircle className="h-6 w-6 text-red-500" />
              <div>
                <p className="text-xl font-bold">{failed}</p>
                <p className="text-sm text-muted-foreground">Failed</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <AlertTriangle className="h-6 w-6 text-amber-500" />
              <div>
                <p className="text-xl font-bold">{paywalled}</p>
                <p className="text-sm text-muted-foreground">Paywall Detected</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-zinc-50 p-4 dark:bg-zinc-900">
              <AlertTriangle className="h-6 w-6 text-orange-500" />
              <div>
                <p className="text-xl font-bold">{paywallCount}</p>
                <p className="text-sm text-muted-foreground">Paywalled Content</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pipeline Progress */}
      <Card>
        <CardHeader>
          <CardTitle>Pipeline Progress</CardTitle>
          <CardDescription>Visual representation of link processing</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Fetched Content</span>
              <span>{totalLinks > 0 ? (((fetched + analyzing + completed) / totalLinks) * 100).toFixed(0) : 0}%</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-2 rounded-full bg-blue-500 transition-all"
                style={{ width: `${totalLinks > 0 ? ((fetched + analyzing + completed) / totalLinks) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Good Readability</span>
              <span>{totalLinks > 0 ? ((withGoodContent / totalLinks) * 100).toFixed(0) : 0}%</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-2 rounded-full bg-green-500 transition-all"
                style={{ width: `${totalLinks > 0 ? (withGoodContent / totalLinks) * 100 : 0}%` }}
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>AI Analyzed</span>
              <span>{totalLinks > 0 ? ((analyzed / totalLinks) * 100).toFixed(0) : 0}%</span>
            </div>
            <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div
                className="h-2 rounded-full bg-purple-500 transition-all"
                style={{ width: `${totalLinks > 0 ? (analyzed / totalLinks) * 100 : 0}%` }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
