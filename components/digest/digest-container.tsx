"use client"

import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { AlertTriangle } from "lucide-react"
import { useDigest, type DigestLink } from "@/hooks/use-digest"
import { useDomains } from "@/hooks/use-domains"
import { DIGEST_BUCKETS, isDigestBucket, type DigestBucket } from "@/lib/link-buckets"
import { Pagination } from "@/components/feed/pagination"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { DigestRow } from "./digest-row"

const BUCKET_INFO: Record<DigestBucket, { label: string; description: string }> = {
  analyzed: {
    label: "Analyzed",
    description: "The AI summary and key points for each article.",
  },
  paywalled: {
    label: "Paywalled",
    description: "Behind a paywall or sign-in, so there was nothing to analyze.",
  },
  unreachable: {
    label: "Couldn't load",
    description: "Every fetcher failed. The reason comes from the first one tried.",
  },
  analysis_failed: {
    label: "Analysis failed",
    description: "Fetched fine, but the AI analysis returned an error.",
  },
  waiting: {
    label: "Waiting",
    description: "Not fetched or analyzed yet. Links in progress for over a day are marked stuck.",
  },
  hidden: {
    label: "Hidden",
    description: "On domains you've hidden. They are skipped and left out of the feed.",
  },
}

/** Group rows under "Week of Mon DD", by the date the email arrived. */
function groupByWeek(links: DigestLink[]): Array<{ label: string; links: DigestLink[] }> {
  const groups: Array<{ label: string; links: DigestLink[] }> = []
  for (const link of links) {
    const date = new Date(link.email?.receivedAt ?? link.createdAt)
    const monday = new Date(date)
    monday.setDate(date.getDate() - ((date.getDay() + 6) % 7))
    const sameYear = monday.getFullYear() === new Date().getFullYear()
    const label = `Week of ${monday.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
    })}`
    const last = groups[groups.length - 1]
    if (last?.label === label) last.links.push(link)
    else groups.push({ label, links: [link] })
  }
  return groups
}

export function DigestContainer() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const groupParam = searchParams.get("group")
  const bucket: DigestBucket = isDigestBucket(groupParam) ? groupParam : "analyzed"
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)

  const { data, links, isLoading, error, mutate } = useDigest(bucket, page)
  const { unhideDomain } = useDomains()

  const navigate = (next: { group?: DigestBucket; page?: number }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next.group) {
      if (next.group === "analyzed") params.delete("group")
      else params.set("group", next.group)
      params.delete("page")
    }
    if (next.page !== undefined) {
      if (next.page === 1) params.delete("page")
      else params.set("page", String(next.page))
    }
    const query = params.toString()
    router.push(`${pathname}${query ? `?${query}` : ""}`)
  }

  const handleUnhide = async (domain: string) => {
    await unhideDomain(domain)
    mutate()
  }

  const notAnalyzed = data
    ? data.counts.paywalled + data.counts.unreachable + data.counts.analysis_failed
    : 0

  return (
    <div className="space-y-4">
      {data?.analysisOffReason && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>{data.analysisOffReason} New links will stay in Waiting until it&apos;s on.</p>
        </div>
      )}

      {data && (
        <p className="text-sm text-muted-foreground">
          {data.counts.analyzed} analyzed · {notAnalyzed} couldn&apos;t be analyzed · {data.counts.waiting}{" "}
          waiting
        </p>
      )}

      <nav aria-label="Digest groups" className="flex flex-wrap gap-2">
        {DIGEST_BUCKETS.map((b) => {
          const count = data?.counts[b]
          const active = b === bucket
          return (
            <button
              key={b}
              type="button"
              onClick={() => navigate({ group: b })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                active
                  ? "border-foreground bg-foreground text-background"
                  : "bg-white hover:bg-muted dark:bg-zinc-900"
              )}
            >
              {BUCKET_INFO[b].label}
              {count !== undefined && (
                <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </nav>

      <p className="text-sm text-muted-foreground">{BUCKET_INFO[bucket].description}</p>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          Failed to load the digest. Please try again.
        </div>
      ) : isLoading ? (
        <div className="space-y-3 rounded-lg border bg-white p-4 dark:bg-zinc-900">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 py-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : links.length === 0 ? (
        <div className="rounded-lg border bg-white p-10 text-center text-muted-foreground dark:bg-zinc-900">
          Nothing here.
        </div>
      ) : (
        <>
          {groupByWeek(links).map((group) => (
            <section key={group.label}>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </h3>
              <div className="rounded-lg border bg-white px-4 dark:bg-zinc-900">
                {group.links.map((link) => (
                  <DigestRow
                    key={link.id}
                    link={link}
                    bucket={bucket}
                    maxAutoAttempts={data?.maxAutoAttempts ?? 3}
                    onChanged={() => mutate()}
                    onUnhideDomain={handleUnhide}
                  />
                ))}
              </div>
            </section>
          ))}
          {data && data.pagination.totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={data.pagination.totalPages}
              total={data.pagination.total}
              limit={data.pagination.limit}
              onPageChange={(p) => navigate({ page: p })}
            />
          )}
        </>
      )}
    </div>
  )
}
