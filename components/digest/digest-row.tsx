"use client"

import { useState } from "react"
import Link from "next/link"
import { FEATURE_FLAGS } from "@/lib/flags"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Archive, ExternalLink, Eye, Loader2, Newspaper, RefreshCw, Sparkles } from "lucide-react"
import type { DigestLink } from "@/hooks/use-digest"
import type { DigestBucket } from "@/lib/link-buckets"

const WAITING_LABELS: Record<string, string> = {
  PENDING: "Waiting to be fetched",
  FETCHING: "Fetching",
  FETCHED: "Waiting for analysis",
  ANALYZING: "Analyzing",
}

const PAYWALL_LABELS: Record<string, string> = {
  hard: "Paid subscription",
  soft: "Metered paywall",
  registration: "Sign-in required",
  insufficient_content: "Not enough content",
}

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

interface DigestRowProps {
  link: DigestLink
  bucket: DigestBucket
  maxAutoAttempts: number
  onChanged: () => void
  onUnhideDomain: (domain: string) => Promise<void>
}

export function DigestRow({ link, bucket, maxAutoAttempts, onChanged, onUnhideDomain }: DigestRowProps) {
  const [pending, setPending] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const href = link.finalUrl || link.url
  // Fetched and queued for analysis, so it can be analyzed right away
  const readyToAnalyze = bucket === "waiting" && link.fetchStatus === "FETCHED"
  const domain = link.finalDomain || link.domain
  const date = link.email?.receivedAt ?? link.createdAt

  const runAction = async (name: string, path: string) => {
    setPending(name)
    setActionError(null)
    try {
      const res = await fetch(`/api/links/${link.id}/${path}`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.success === false) {
        throw new Error(data.error || "That didn't work")
      }
      onChanged()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "That didn't work")
    } finally {
      setPending(null)
    }
  }

  const unhide = async () => {
    const hidden = link.domain || link.finalDomain
    if (!hidden) return
    setPending("unhide")
    try {
      await onUnhideDomain(hidden)
    } finally {
      setPending(null)
    }
  }

  const actionButton = (name: string, label: string, icon: React.ReactNode, onClick: () => void) => (
    <Button variant="outline" size="sm" disabled={pending !== null} onClick={onClick}>
      {pending === name ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : icon}
      {label}
    </Button>
  )

  return (
    <article className="border-b py-4 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium leading-snug hover:underline break-words"
          >
            {link.title || href}
            <ExternalLink className="ml-1 inline h-3.5 w-3.5 align-baseline text-muted-foreground" />
          </a>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {[domain, formatDate(date), link.readingTimeMin ? `${link.readingTimeMin} min read` : null]
              .filter(Boolean)
              .join(" · ")}
            {link.isRead && (
              <span className="ml-1.5 inline-flex items-center gap-0.5">
                · <Eye className="h-3 w-3" /> Read
              </span>
            )}
          </p>
        </div>
        {bucket === "analyzed" && link.isPaywalled && (
          <Badge variant="outline" className="shrink-0 border-amber-500 text-amber-700 dark:text-amber-400">
            Teaser only
          </Badge>
        )}
        {bucket === "paywalled" && (
          <Badge variant="outline" className="shrink-0 border-amber-500 text-amber-700 dark:text-amber-400">
            {PAYWALL_LABELS[link.paywallType ?? ""] ?? "Paywall"}
          </Badge>
        )}
        {bucket === "waiting" && link.stuck && (
          <Badge variant="outline" className="shrink-0 border-red-500 text-red-700 dark:text-red-400">
            Stuck
          </Badge>
        )}
      </div>

      {bucket === "analyzed" && (
        <div className="mt-2 space-y-2 text-sm">
          {link.aiSummary ? (
            <p>{link.aiSummary}</p>
          ) : (
            <p className="text-muted-foreground">No summary was produced.</p>
          )}
          {link.aiKeyPoints.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              {link.aiKeyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          )}
          {link.contentTags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {link.contentTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-[10px]">
                  {tag.replace(/_/g, " ").toLowerCase()}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}

      {bucket === "unreachable" && link.failure && (
        <p className="mt-2 text-sm">
          <span className="font-medium">{link.failure.label}.</span>{" "}
          {link.failure.error && (
            <span className="break-words text-muted-foreground">{link.failure.error}</span>
          )}
        </p>
      )}

      {bucket === "paywalled" && link.paywallType === "insufficient_content" && (
        <p className="mt-2 text-sm text-muted-foreground">
          The page loaded but had too little readable text to analyze. It may need JavaScript,
          or only show a teaser.
        </p>
      )}

      {(bucket === "unreachable" || bucket === "paywalled") && link.tried.length > 1 && (
        <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
          {link.tried.map((attempt, i) => (
            <li key={i} className="break-words">
              Tried {attempt.fetcher}: {attempt.error || "no usable content"}
            </li>
          ))}
        </ul>
      )}

      {bucket === "analysis_failed" && (
        <div className="mt-2 space-y-1 text-sm">
          <p className="break-words text-muted-foreground">{link.analysisError}</p>
          <p className="text-xs text-muted-foreground">
            Failed {link.analysisAttempts} {link.analysisAttempts === 1 ? "time" : "times"} ·{" "}
            {link.autoRetry
              ? "will be tried again on the next sync"
              : `automatic retries stopped after ${maxAutoAttempts}`}
          </p>
        </div>
      )}

      {bucket === "waiting" && (
        <p className="mt-2 text-sm text-muted-foreground">
          {WAITING_LABELS[link.fetchStatus] ?? link.fetchStatus}
          {link.stuck && ` since ${formatDate(link.updatedAt)}`}
        </p>
      )}

      {bucket === "hidden" && (
        <p className="mt-2 text-sm text-muted-foreground">
          {domain} is hidden, so this link isn&apos;t fetched or shown in the feed.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(bucket === "unreachable" || bucket === "paywalled") && (
          <>
            {actionButton("refetch", "Retry", <RefreshCw className="mr-1.5 h-3.5 w-3.5" />, () =>
              runAction("refetch", "refetch")
            )}
            {actionButton("wayback", "Try Wayback", <Archive className="mr-1.5 h-3.5 w-3.5" />, () =>
              runAction("wayback", "wayback")
            )}
          </>
        )}
        {bucket === "analysis_failed" &&
          actionButton("analyze", "Analyze again", <Sparkles className="mr-1.5 h-3.5 w-3.5" />, () =>
            runAction("analyze", "analyze")
          )}
        {readyToAnalyze &&
          FEATURE_FLAGS.enableAnalysis &&
          actionButton("analyze", "Analyze now", <Sparkles className="mr-1.5 h-3.5 w-3.5" />, () =>
            runAction("analyze", "analyze")
          )}
        {bucket === "hidden" &&
          actionButton("unhide", "Unhide domain", <Eye className="mr-1.5 h-3.5 w-3.5" />, unhide)}
        {/* Hidden-domain links aren't in the feed */}
        {bucket !== "hidden" && (
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/feed?link=${link.id}`}>
              <Newspaper className="mr-1.5 h-3.5 w-3.5" />
              Open in feed
            </Link>
          </Button>
        )}
      </div>

      {actionError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{actionError}</p>}
    </article>
  )
}
