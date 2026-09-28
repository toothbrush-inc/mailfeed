"use client"

import { useState } from "react"
import Link from "next/link"
import { FEATURE_FLAGS } from "@/lib/flags"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Archive, ExternalLink, Eye, Heart, Loader2, Newspaper, RefreshCw, Sparkles } from "lucide-react"
import type { DigestLink, DigestSharedLink } from "@/hooks/use-digest"
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

const SHARED_STATUS_LABELS: Record<string, string> = {
  COMPLETED: "Analyzed",
  PENDING: "Not fetched yet",
  FETCHING: "Fetching",
  FETCHED: "Fetched, not analyzed yet",
  ANALYZING: "Analyzing",
  FAILED: "Couldn't load",
}

function sharedStatusLabel(shared: DigestSharedLink): string {
  if (shared.fetchStatus === "PAYWALL_DETECTED") {
    return PAYWALL_LABELS[shared.paywallType ?? ""] ?? "Paywall"
  }
  const status = SHARED_STATUS_LABELS[shared.fetchStatus] ?? shared.fetchStatus
  // Fetched but flagged as paywalled: only a teaser is available
  if (shared.paywallType && shared.fetchStatus !== "COMPLETED") {
    return `${PAYWALL_LABELS[shared.paywallType] ?? "Paywall"} · ${status}`
  }
  return status
}

/** Summary, key points and tags from one analysis. */
function AnalysisBlock({ analysis }: { analysis: Pick<DigestLink, "aiSummary" | "aiKeyPoints" | "contentTags"> }) {
  return (
    <>
      {analysis.aiSummary ? (
        <p>{analysis.aiSummary}</p>
      ) : (
        <p className="text-muted-foreground">No summary was produced.</p>
      )}
      {analysis.aiKeyPoints.length > 0 && (
        <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
          {analysis.aiKeyPoints.map((point, i) => (
            <li key={i}>{point}</li>
          ))}
        </ul>
      )}
      {analysis.contentTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {analysis.contentTags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              {tag.replace(/_/g, " ").toLowerCase()}
            </Badge>
          ))}
        </div>
      )}
    </>
  )
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
  const [isLiked, setIsLiked] = useState(link.isLiked)
  const [isTogglingLike, setIsTogglingLike] = useState(false)

  const href = link.finalUrl || link.url
  // Fetched and queued for analysis, so it can be analyzed right away
  const readyToAnalyze = bucket === "waiting" && link.fetchStatus === "FETCHED"
  const domain = link.finalDomain || link.domain
  const date = link.email?.receivedAt ?? link.createdAt

  // A post counted as analyzed through the article it shares
  const analyzedViaShared = bucket === "analyzed" && link.fetchStatus !== "COMPLETED"
  const analyzedShared = link.sharedLinks.filter((s) => s.fetchStatus === "COMPLETED")

  const runAction = async (name: string, path: string, linkId: string = link.id) => {
    setPending(name)
    setActionError(null)
    try {
      const res = await fetch(`/api/links/${linkId}/${path}`, { method: "POST" })
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

  // Optimistic like toggle; never touches read state
  const toggleLike = async () => {
    const next = !isLiked
    setIsLiked(next)
    setIsTogglingLike(true)
    try {
      const res = await fetch(`/api/links/${link.id}/like`, { method: next ? "POST" : "DELETE" })
      if (!res.ok) throw new Error("Couldn't update like")
      onChanged()
    } catch (error) {
      setIsLiked(!next)
      setActionError(error instanceof Error ? error.message : "Couldn't update like")
    } finally {
      setIsTogglingLike(false)
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
      {/* On phones the status badge sits above the title so the title keeps the full width */}
      <div className="flex flex-col-reverse items-start gap-1.5 sm:flex-row sm:justify-between sm:gap-3">
        <div className="w-full min-w-0 flex-1">
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
        {bucket === "analyzed" && !analyzedViaShared && link.isPaywalled && (
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

      {bucket === "analyzed" && !analyzedViaShared && (
        <div className="mt-2 space-y-2 text-sm">
          <AnalysisBlock analysis={link} />
        </div>
      )}

      {analyzedViaShared &&
        analyzedShared.map((shared) => (
          <div key={shared.id} className="mt-2 space-y-2 border-l-2 pl-3 text-sm">
            <p className="text-xs text-muted-foreground">
              Shared article:{" "}
              <a
                href={shared.finalUrl || shared.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-foreground hover:underline break-words"
              >
                {shared.title || shared.finalUrl || shared.url}
              </a>
              {" · "}
              {[shared.finalDomain || shared.domain, shared.readingTimeMin ? `${shared.readingTimeMin} min read` : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
            <AnalysisBlock analysis={shared} />
          </div>
        ))}

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
          Too little text to analyze: a page that needs JavaScript, a teaser or sign-in page, or a
          short post that only shares a link.
        </p>
      )}

      {bucket === "paywalled" && link.sharedLinks.length > 0 && (
        <ul className="mt-2 space-y-1.5 text-sm">
          {link.sharedLinks.map((shared) => (
            <li key={shared.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-muted-foreground">Links to</span>
              <a
                href={shared.finalUrl || shared.url}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 break-all hover:underline"
              >
                {shared.finalDomain || shared.domain || shared.url}
              </a>
              <Badge variant="outline" className="text-[10px]">
                {sharedStatusLabel(shared)}
              </Badge>
              {shared.fetchStatus === "FETCHED" &&
                FEATURE_FLAGS.enableAnalysis &&
                actionButton(`analyze-${shared.id}`, "Analyze", <Sparkles className="mr-1.5 h-3.5 w-3.5" />, () =>
                  runAction(`analyze-${shared.id}`, "analyze", shared.id)
                )}
            </li>
          ))}
        </ul>
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
        {/* Like toggle (does not change read state) */}
        <Button
          variant="ghost"
          size="sm"
          onClick={toggleLike}
          disabled={isTogglingLike}
          aria-pressed={isLiked}
          aria-label={isLiked ? "Unlike" : "Like"}
          title={isLiked ? "Unlike" : "Like"}
        >
          <Heart className={isLiked ? "h-3.5 w-3.5 fill-current text-rose-500" : "h-3.5 w-3.5"} />
        </Button>
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
