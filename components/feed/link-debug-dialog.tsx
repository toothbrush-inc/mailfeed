"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Bug,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Code,
  MinusCircle,
  Circle,
  ArrowUpCircle,
  Sparkles,
  Database,
  RefreshCw,
} from "lucide-react"
import { useFetchAttempts } from "@/hooks/use-fetch-attempts"

interface LinkDebugDialogProps {
  linkId: string
  linkUrl: string
  link: {
    fetchStatus: string
    fetchError: string | null
    fetchedAt: string | null
    analyzedAt: string | null
    contentSource: string | null
    finalUrl: string | null
    finalDomain: string | null
    wasRedirected: boolean
    wordCount: number | null
    readingTimeMin: number | null
    aiCategory: string | null
    aiTags: string[]
    linkTags: string[]
    contentTags: string[]
    metadataTags: string[]
    embeddingStatus: string | null
    embeddedAt: string | null
    embeddingError: string | null
    createdAt: string
    updatedAt: string
  }
  onPromoteAttempt?: () => void
  onAction?: () => void
}

type StepStatus = "success" | "failed" | "pending" | "skipped"

interface PipelineStep {
  label: string
  status: StepStatus
  timestamp: string | null
}

interface AttemptRawHtmlState {
  [attemptId: string]: { loading: boolean; html: string | null }
}

interface OperationGroup {
  operationId: string
  trigger: string
  createdAt: string
  overallSuccess: boolean
  attempts: Array<{
    id: string
    fetcherId: string
    fetcherName: string | null
    sequence: number
    success: boolean
    error: string | null
    httpStatus: number | null
    durationMs: number
    createdAt: string
  }>
}

function derivePipelineSteps(link: LinkDebugDialogProps["link"]): PipelineStep[] {
  // Fetch status
  let fetchStatus: StepStatus = "pending"
  if (["COMPLETED", "FETCHED", "ANALYZING"].includes(link.fetchStatus)) {
    fetchStatus = "success"
  } else if (["FAILED", "PAYWALL_DETECTED"].includes(link.fetchStatus)) {
    fetchStatus = "failed"
  } else if (["PENDING", "FETCHING"].includes(link.fetchStatus)) {
    fetchStatus = "pending"
  }

  // Analysis status
  let analysisStatus: StepStatus = "pending"
  if (link.analyzedAt) {
    analysisStatus = "success"
  } else if (link.fetchStatus === "ANALYZING") {
    analysisStatus = "pending"
  } else if (link.linkTags?.length > 0 || link.contentTags?.length > 0 || link.aiCategory) {
    analysisStatus = "success"
  } else if (["FAILED", "PAYWALL_DETECTED"].includes(link.fetchStatus)) {
    analysisStatus = "skipped"
  }

  // Embedding status
  let embeddingStep: StepStatus = "pending"
  const es = link.embeddingStatus
  if (es === "COMPLETED") {
    embeddingStep = "success"
  } else if (es === "FAILED") {
    embeddingStep = "failed"
  } else if (es === "PROCESSING") {
    embeddingStep = "pending"
  } else if (es === "SKIPPED") {
    embeddingStep = "skipped"
  } else if (["FAILED", "PAYWALL_DETECTED"].includes(link.fetchStatus)) {
    embeddingStep = "skipped"
  }

  return [
    { label: "Fetched", status: fetchStatus, timestamp: link.fetchedAt },
    { label: "Analyzed", status: analysisStatus, timestamp: link.analyzedAt },
    { label: "Embedded", status: embeddingStep, timestamp: link.embeddedAt },
  ]
}

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case "failed":
      return <XCircle className="h-4 w-4 text-red-500" />
    case "pending":
      return <Circle className="h-4 w-4 text-muted-foreground animate-pulse" />
    case "skipped":
      return <MinusCircle className="h-4 w-4 text-muted-foreground/50" />
  }
}

function formatTimestamp(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  })
}

function formatTrigger(trigger: string): string {
  switch (trigger) {
    case "sync":
      return "Sync"
    case "refetch":
      return "Refetch"
    case "wayback_manual":
      return "Manual Archive"
    default:
      return trigger
  }
}

function triggerVariant(trigger: string): "default" | "secondary" | "outline" {
  switch (trigger) {
    case "sync":
      return "secondary"
    case "refetch":
      return "default"
    case "wayback_manual":
      return "outline"
    default:
      return "secondary"
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

export function LinkDebugDialog({ linkId, linkUrl, link, onPromoteAttempt, onAction }: LinkDebugDialogProps) {
  const [open, setOpen] = useState(false)
  const { attempts, isLoading: isLoadingAttempts } = useFetchAttempts(open ? linkId : null)
  const [rawHtmlState, setRawHtmlState] = useState<AttemptRawHtmlState>({})
  const [visibleAttemptHtml, setVisibleAttemptHtml] = useState<Set<string>>(new Set())
  const [promotingAttemptId, setPromotingAttemptId] = useState<string | null>(null)
  const [isRefetching, setIsRefetching] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isEmbedding, setIsEmbedding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [linkRawHtml, setLinkRawHtml] = useState<{ loading: boolean; content: string | null }>({
    loading: false,
    content: null,
  })
  const [showLinkRawHtml, setShowLinkRawHtml] = useState(false)

  const steps = derivePipelineSteps(link)

  // Group attempts by operationId
  const operations: OperationGroup[] = []
  const operationMap = new Map<string, OperationGroup>()

  for (const attempt of attempts) {
    let group = operationMap.get(attempt.operationId)
    if (!group) {
      group = {
        operationId: attempt.operationId,
        trigger: attempt.trigger,
        createdAt: attempt.createdAt,
        overallSuccess: false,
        attempts: [],
      }
      operationMap.set(attempt.operationId, group)
      operations.push(group)
    }
    group.attempts.push(attempt)
    if (attempt.success) {
      group.overallSuccess = true
    }
  }

  for (const op of operations) {
    op.attempts.sort((a, b) => a.sequence - b.sequence)
  }

  // Determine which attempt is currently active on the link.
  // Match the most recent successful attempt whose fetcherId matches
  // the link's contentSource and was created on or before fetchedAt.
  const activeAttemptId = (() => {
    if (!link.contentSource || !link.fetchedAt) return null
    const fetchedAt = new Date(link.fetchedAt).getTime()
    let best: { id: string; createdAt: number } | null = null
    for (const attempt of attempts) {
      if (!attempt.success || attempt.fetcherId !== link.contentSource) continue
      const t = new Date(attempt.createdAt).getTime()
      // Allow 5 s tolerance (fetchedAt is set slightly after the attempt is recorded)
      if (t <= fetchedAt + 5000) {
        if (!best || t > best.createdAt) {
          best = { id: attempt.id, createdAt: t }
        }
      }
    }
    return best?.id ?? null
  })()

  const handleToggleAttemptHtml = async (attemptId: string) => {
    // Already loaded — just toggle visibility
    if (rawHtmlState[attemptId]?.html != null) {
      setVisibleAttemptHtml((prev) => {
        const next = new Set(prev)
        if (next.has(attemptId)) {
          next.delete(attemptId)
        } else {
          next.add(attemptId)
        }
        return next
      })
      return
    }

    // Not loaded yet — fetch and show
    setRawHtmlState((prev) => ({
      ...prev,
      [attemptId]: { loading: true, html: null },
    }))
    setVisibleAttemptHtml((prev) => new Set(prev).add(attemptId))

    try {
      const response = await fetch(`/api/links/${linkId}/attempts/${attemptId}`)
      if (!response.ok) throw new Error("Failed to load attempt")
      const data = await response.json()
      setRawHtmlState((prev) => ({
        ...prev,
        [attemptId]: { loading: false, html: data.attempt.rawHtml || "No HTML captured" },
      }))
    } catch {
      setRawHtmlState((prev) => ({
        ...prev,
        [attemptId]: { loading: false, html: "Error loading HTML" },
      }))
    }
  }

  const handleToggleLinkRawHtml = async () => {
    // Already loaded — just toggle visibility
    if (linkRawHtml.content !== null) {
      setShowLinkRawHtml((prev) => !prev)
      return
    }

    // Not loaded yet — fetch and show
    setShowLinkRawHtml(true)
    setLinkRawHtml({ loading: true, content: null })

    try {
      const response = await fetch(`/api/links/${linkId}/raw`)
      if (!response.ok) throw new Error("Failed to load raw content")
      const data = await response.json()
      const content = data.rawHtml || data.contentText || "No content stored"
      const label = data.rawHtml ? "[rawHtml]" : "[contentText]"
      setLinkRawHtml({ loading: false, content: `${label}\n\n${content}` })
    } catch {
      setLinkRawHtml({ loading: false, content: "Error loading content" })
    }
  }

  const handlePromoteAttempt = async (attemptId: string) => {
    setPromotingAttemptId(attemptId)
    try {
      const response = await fetch(`/api/links/${linkId}/promote-attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Failed to promote attempt")
      }
      setOpen(false)
      onPromoteAttempt?.()
    } catch (error) {
      console.error("Failed to promote attempt:", error)
    } finally {
      setPromotingAttemptId(null)
    }
  }

  const handleRefetch = async () => {
    setIsRefetching(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/links/${linkId}/refetch`, {
        method: "POST",
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Refetch failed")
      }
      onAction?.()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Refetch failed")
    } finally {
      setIsRefetching(false)
    }
  }

  const handleAnalyze = async () => {
    setIsAnalyzing(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/links/${linkId}/analyze`, {
        method: "POST",
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Analysis failed")
      }
      onAction?.()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Analysis failed")
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleEmbed = async () => {
    setIsEmbedding(true)
    setActionError(null)
    try {
      const response = await fetch(`/api/embeddings/generate?limit=1`, {
        method: "POST",
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Embedding failed")
      }
      onAction?.()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Embedding failed")
    } finally {
      setIsEmbedding(false)
    }
  }

  const tagCount =
    (link.linkTags?.length || 0) +
    (link.contentTags?.length || 0) +
    (link.metadataTags?.length || 0) +
    (link.aiTags?.length || 0)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Bug className="mr-1 h-4 w-4" />
          Debug
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Link Debug</DialogTitle>
          <DialogDescription className="break-all">
            {linkUrl}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-auto max-h-[60vh] space-y-6">
          {/* Section 1: Pipeline Status */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Pipeline Status</h4>
            <div className="flex items-center gap-2">
              {steps.map((step, i) => (
                <div key={step.label} className="flex items-center gap-2">
                  {i > 0 && (
                    <div className="w-6 h-px bg-border" />
                  )}
                  <div className="flex items-center gap-1.5 rounded-md border px-3 py-1.5">
                    <StepIcon status={step.status} />
                    <span className="text-sm font-medium">{step.label}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-6 text-xs text-muted-foreground">
              {steps.map((step) => (
                <span key={step.label}>
                  {step.timestamp ? formatTimestamp(step.timestamp) : "\u2014"}
                </span>
              ))}
            </div>

            {/* Pipeline action buttons */}
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleRefetch}
                disabled={isRefetching || isAnalyzing || isEmbedding}
              >
                {isRefetching ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-3 w-3" />
                )}
                Refetch
              </Button>
              {(steps[1].status === "pending" || steps[1].status === "failed") && steps[0].status === "success" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleAnalyze}
                  disabled={isRefetching || isAnalyzing || isEmbedding}
                >
                  {isAnalyzing ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="mr-1 h-3 w-3" />
                  )}
                  {steps[1].status === "failed" ? "Re-analyze" : "Analyze"}
                </Button>
              )}
              {(steps[2].status === "pending" || steps[2].status === "failed") && steps[0].status === "success" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={handleEmbed}
                  disabled={isRefetching || isAnalyzing || isEmbedding}
                >
                  {isEmbedding ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : (
                    <Database className="mr-1 h-3 w-3" />
                  )}
                  {steps[2].status === "failed" ? "Re-embed" : "Embed"}
                </Button>
              )}
            </div>

            {actionError && (
              <p className="text-xs text-red-500">{actionError}</p>
            )}
          </div>

          {/* Section 2: Details Grid */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Details</h4>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Fetch Status</span>
                <Badge variant="outline" className="text-xs font-mono">
                  {link.fetchStatus}
                </Badge>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Content Source</span>
                <span className="font-mono text-xs">{link.contentSource || "\u2014"}</span>
              </div>
              {link.finalUrl && (
                <div className="col-span-2 flex justify-between gap-2">
                  <span className="text-muted-foreground shrink-0">Final URL</span>
                  <span className="text-xs text-right break-all">{link.finalUrl}</span>
                </div>
              )}
              {link.finalDomain && link.finalDomain !== link.contentSource && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Final Domain</span>
                  <span className="text-xs">{link.finalDomain}</span>
                </div>
              )}
              {link.fetchError && (
                <div className="col-span-2 flex justify-between gap-2">
                  <span className="text-muted-foreground">Fetch Error</span>
                  <span className="text-xs text-red-500 text-right truncate max-w-[300px]" title={link.fetchError}>
                    {link.fetchError}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">AI Category</span>
                <span className="text-xs">{link.aiCategory || "\u2014"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Tags</span>
                <span className="text-xs">{tagCount > 0 ? `${tagCount} tags` : "\u2014"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Embedding</span>
                <span className="font-mono text-xs">{link.embeddingStatus || "\u2014"}</span>
              </div>
              {link.embeddingError && (
                <div className="col-span-2 flex justify-between gap-2">
                  <span className="text-muted-foreground">Embedding Error</span>
                  <span className="text-xs text-red-500 text-right truncate max-w-[300px]" title={link.embeddingError}>
                    {link.embeddingError}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Word Count</span>
                <span className="text-xs">{link.wordCount?.toLocaleString() || "\u2014"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Reading Time</span>
                <span className="text-xs">{link.readingTimeMin ? `${link.readingTimeMin} min` : "\u2014"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Created</span>
                <span className="text-xs">{formatTimestamp(link.createdAt)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">Updated</span>
                <span className="text-xs">{formatTimestamp(link.updatedAt)}</span>
              </div>
              {link.fetchedAt && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Fetched At</span>
                  <span className="text-xs">{formatTimestamp(link.fetchedAt)}</span>
                </div>
              )}
              {link.analyzedAt && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Analyzed At</span>
                  <span className="text-xs">{formatTimestamp(link.analyzedAt)}</span>
                </div>
              )}
              {link.embeddedAt && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground">Embedded At</span>
                  <span className="text-xs">{formatTimestamp(link.embeddedAt)}</span>
                </div>
              )}
            </div>

            {/* View Raw HTML button */}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={handleToggleLinkRawHtml}
              >
                <Code className="mr-1 h-3 w-3" />
                {showLinkRawHtml ? "Hide Raw HTML" : "View Raw HTML"}
              </Button>
              {showLinkRawHtml && linkRawHtml.loading && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading...
                </div>
              )}
              {showLinkRawHtml && linkRawHtml.content !== null && (
                <div className="mt-2 overflow-auto max-h-[200px] rounded border bg-muted p-2">
                  <pre className="text-xs whitespace-pre-wrap font-mono break-words">
                    {linkRawHtml.content}
                  </pre>
                </div>
              )}
            </div>
          </div>

          {/* Section 3: Fetch Attempts */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Fetch Attempts</h4>
            {isLoadingAttempts ? (
              <div className="flex items-center justify-center gap-2 py-4 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading fetch history...
              </div>
            ) : operations.length === 0 ? (
              <div className="text-center py-4 text-sm text-muted-foreground">
                No fetch attempts recorded yet.
              </div>
            ) : (
              operations.map((op) => (
                <div
                  key={op.operationId}
                  className="rounded-lg border p-4 space-y-3"
                >
                  {/* Operation header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={triggerVariant(op.trigger)}>
                        {formatTrigger(op.trigger)}
                      </Badge>
                      {op.overallSuccess ? (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-500" />
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatTimestamp(op.createdAt)}
                    </span>
                  </div>

                  {/* Attempt timeline */}
                  <div className="space-y-0">
                    {op.attempts.map((attempt, idx) => (
                      <div key={attempt.id}>
                        <div className="flex items-start gap-3">
                          {/* Timeline line */}
                          <div className="flex flex-col items-center">
                            <div
                              className={`h-2 w-2 rounded-full mt-1.5 ${
                                attempt.success
                                  ? "bg-green-500"
                                  : "bg-red-500"
                              }`}
                            />
                            {idx < op.attempts.length - 1 && (
                              <div className="w-px flex-1 bg-border min-h-[24px]" />
                            )}
                          </div>

                          {/* Attempt details */}
                          <div className="flex-1 pb-3 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium">
                                  {attempt.fetcherName || attempt.fetcherId}
                                </span>
                                {attempt.success ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                )}
                                {activeAttemptId === attempt.id && (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-green-500 text-green-600 dark:text-green-400">
                                    Active
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                                <Clock className="h-3 w-3" />
                                {formatDuration(attempt.durationMs)}
                              </div>
                            </div>
                            {attempt.error && (
                              <p className="text-xs text-red-500 mt-1 break-words">
                                {attempt.error}
                              </p>
                            )}
                            <div className="flex items-center gap-1 mt-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-xs"
                                onClick={() => handleToggleAttemptHtml(attempt.id)}
                              >
                                <Code className="mr-1 h-3 w-3" />
                                {visibleAttemptHtml.has(attempt.id) ? "Hide HTML" : "View HTML"}
                              </Button>
                              {attempt.success && activeAttemptId !== attempt.id && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => handlePromoteAttempt(attempt.id)}
                                  disabled={promotingAttemptId !== null}
                                >
                                  {promotingAttemptId === attempt.id ? (
                                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                  ) : (
                                    <ArrowUpCircle className="mr-1 h-3 w-3" />
                                  )}
                                  Use this content
                                </Button>
                              )}
                            </div>
                            {visibleAttemptHtml.has(attempt.id) && rawHtmlState[attempt.id]?.loading && (
                              <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                <Loader2 className="h-3 w-3 animate-spin" />
                                Loading...
                              </div>
                            )}
                            {visibleAttemptHtml.has(attempt.id) && rawHtmlState[attempt.id]?.html != null && (
                              <div className="mt-2 overflow-auto max-h-[200px] rounded border bg-muted p-2">
                                <pre className="text-xs whitespace-pre-wrap font-mono break-words">
                                  {rawHtmlState[attempt.id].html}
                                </pre>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
