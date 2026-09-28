"use client"

import useSWR from "swr"
import type { DigestBucket } from "@/lib/link-buckets"

export interface DigestSharedLink {
  id: string
  url: string
  finalUrl: string | null
  domain: string | null
  finalDomain: string | null
  title: string | null
  aiSummary: string | null
  aiKeyPoints: string[]
  contentTags: string[]
  readingTimeMin: number | null
  worthinessScore: number | null
  highlightReason: string | null
  fetchStatus: string
  paywallType: string | null
}

export interface DigestLink {
  id: string
  url: string
  finalUrl: string | null
  domain: string | null
  finalDomain: string | null
  title: string | null
  aiSummary: string | null
  aiKeyPoints: string[]
  contentTags: string[]
  readingTimeMin: number | null
  worthinessScore: number | null
  highlightReason: string | null
  isPaywalled: boolean
  paywallType: string | null
  fetchStatus: string
  fetchError: string | null
  analysisError: string | null
  analysisAttempts: number
  archivedUrl: string | null
  isRead: boolean
  isLiked: boolean
  createdAt: string
  updatedAt: string
  email: { gmailId: string; subject: string | null; receivedAt: string } | null
  /** Links found inside this one (e.g. the article a post shares). */
  sharedLinks: DigestSharedLink[]
  /** Why the fetch failed, for the "unreachable" group. */
  failure: { kind: string; label: string; error: string | null } | null
  /** Fetchers tried in the most recent run, in order. */
  tried: Array<{ fetcher: string; error: string | null }>
  stuck: boolean
  /** Analysis failed but the worker will try again on its own. */
  autoRetry: boolean
}

interface DigestResponse {
  bucket: DigestBucket
  counts: Record<DigestBucket, number>
  analysisOffReason: string | null
  maxAutoAttempts: number
  links: DigestLink[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Digest request failed: ${res.status}`)
    return res.json()
  })

export function useDigest(bucket: DigestBucket, page: number) {
  const params = new URLSearchParams({ bucket })
  if (page > 1) params.set("page", String(page))

  const { data, error, isLoading, mutate } = useSWR<DigestResponse>(
    `/api/digest?${params}`,
    fetcher,
    // Keep the counts on screen while switching groups
    { keepPreviousData: true }
  )

  // Rows from the previous group or page are stale while the new one loads
  const isCurrent = data?.bucket === bucket && data.pagination.page === page

  return {
    data,
    links: isCurrent && data ? data.links : [],
    isLoading: isLoading || (!!data && !isCurrent),
    error,
    mutate,
  }
}
