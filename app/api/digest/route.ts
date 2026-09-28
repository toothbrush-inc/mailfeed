import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { getUserSettings } from "@/lib/user-settings"
import { getUserAiKeys } from "@/lib/user-keys"
import { isAiConfigured } from "@/lib/ai-provider"
import { FEATURE_FLAGS } from "@/lib/flags"
import { MAX_AUTO_ANALYSIS_ATTEMPTS } from "@/lib/analysis"
import {
  DIGEST_BUCKETS,
  FAILURE_LABELS,
  STUCK_AFTER_MS,
  bucketWhere,
  classifyFetchError,
  isDigestBucket,
  primaryFetchError,
  type DigestBucket,
} from "@/lib/link-buckets"

export async function GET(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const searchParams = request.nextUrl.searchParams
  const bucketParam = searchParams.get("bucket")
  const bucket: DigestBucket = isDigestBucket(bucketParam) ? bucketParam : "analyzed"
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "30") || 30, 1), 100)

  const [user, settings, aiKeys] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { hiddenDomains: true } }),
    getUserSettings(userId),
    getUserAiKeys(userId),
  ])
  const hiddenDomains = user?.hiddenDomains || []

  const where = bucketWhere(bucket, userId, hiddenDomains)
  const showFetchAttempts = bucket === "unreachable" || bucket === "paywalled"
  // A post's shared articles stand in for its own analysis when it has too
  // little text; show them on Analyzed and Paywalled rows
  const showSharedLinks = bucket === "analyzed" || bucket === "paywalled"

  const [counts, links, total] = await Promise.all([
    Promise.all(
      DIGEST_BUCKETS.map((b) => prisma.link.count({ where: bucketWhere(b, userId, hiddenDomains) }))
    ),
    prisma.link.findMany({
      where,
      orderBy: [{ email: { receivedAt: "desc" } }, { createdAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        url: true,
        finalUrl: true,
        domain: true,
        finalDomain: true,
        title: true,
        aiSummary: true,
        aiKeyPoints: true,
        contentTags: true,
        readingTimeMin: true,
        isPaywalled: true,
        paywallType: true,
        fetchStatus: true,
        fetchError: true,
        analysisError: true,
        analysisAttempts: true,
        archivedUrl: true,
        isRead: true,
        isLiked: true,
        createdAt: true,
        updatedAt: true,
        email: {
          where: { userId },
          select: { gmailId: true, subject: true, receivedAt: true },
        },
        childLinks: showSharedLinks
          ? {
              where: { userId },
              orderBy: { createdAt: "asc" },
              take: 3,
              select: {
                id: true,
                url: true,
                finalUrl: true,
                domain: true,
                finalDomain: true,
                title: true,
                aiSummary: true,
                aiKeyPoints: true,
                contentTags: true,
                readingTimeMin: true,
                fetchStatus: true,
                paywallType: true,
              },
            }
          : false,
        fetchAttempts: showFetchAttempts
          ? {
              orderBy: { createdAt: "desc" },
              take: 6,
              select: {
                operationId: true,
                fetcherId: true,
                fetcherName: true,
                sequence: true,
                success: true,
                error: true,
              },
            }
          : false,
      },
    }),
    prisma.link.count({ where }),
  ])

  const now = Date.now()
  const rows = links.map(({ fetchAttempts, childLinks, ...link }) => {
    let failure: { kind: string; label: string; error: string | null } | null = null
    let tried: Array<{ fetcher: string; error: string | null }> = []
    if (showFetchAttempts) {
      const primary = primaryFetchError(link.fetchError, fetchAttempts || [])
      tried = primary.tried.map((a) => ({ fetcher: a.fetcherName || a.fetcherId, error: a.error }))
      if (bucket === "unreachable") {
        const kind = classifyFetchError(primary.error)
        failure = { kind, label: FAILURE_LABELS[kind], error: primary.error }
      }
    }
    const inFlight = link.fetchStatus === "FETCHING" || link.fetchStatus === "ANALYZING"
    return {
      ...link,
      sharedLinks: childLinks || [],
      failure,
      tried,
      stuck: inFlight && now - new Date(link.updatedAt).getTime() > STUCK_AFTER_MS,
      autoRetry:
        link.fetchStatus === "FETCHED" && link.analysisAttempts < MAX_AUTO_ANALYSIS_ATTEMPTS,
    }
  })

  let analysisOffReason: string | null = null
  if (!FEATURE_FLAGS.enableAnalysis) {
    analysisOffReason = "Analysis is turned off for this server."
  } else if (!settings.analysis.enabled) {
    analysisOffReason = "Analysis is turned off in Settings."
  } else if (!isAiConfigured(settings, aiKeys)) {
    analysisOffReason = "No API key is set for the selected AI model."
  }

  return NextResponse.json({
    bucket,
    counts: Object.fromEntries(DIGEST_BUCKETS.map((b, i) => [b, counts[i]])),
    analysisOffReason,
    maxAutoAttempts: MAX_AUTO_ANALYSIS_ATTEMPTS,
    links: rows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  })
}
