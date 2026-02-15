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
import { History, Loader2, CheckCircle2, XCircle, Clock, Code } from "lucide-react"
import { useFetchAttempts } from "@/hooks/use-fetch-attempts"

interface FetchHistoryDialogProps {
  linkId: string
  linkUrl: string
}

interface AttemptRawHtmlState {
  [attemptId: string]: { loading: boolean; html: string | null }
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

export function FetchHistoryDialog({ linkId, linkUrl }: FetchHistoryDialogProps) {
  const [open, setOpen] = useState(false)
  const { attempts, isLoading } = useFetchAttempts(open ? linkId : null)
  const [rawHtmlState, setRawHtmlState] = useState<AttemptRawHtmlState>({})

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

  // Sort attempts within each group by sequence
  for (const op of operations) {
    op.attempts.sort((a, b) => a.sequence - b.sequence)
  }

  const handleViewHtml = async (attemptId: string) => {
    if (rawHtmlState[attemptId]?.html !== undefined && rawHtmlState[attemptId]?.html !== null) return

    setRawHtmlState((prev) => ({
      ...prev,
      [attemptId]: { loading: true, html: null },
    }))

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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <History className="mr-1 h-4 w-4" />
          History
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Fetch History</DialogTitle>
          <DialogDescription className="truncate">
            {linkUrl}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-auto max-h-[60vh] space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading fetch history...
            </div>
          ) : operations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
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
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs mt-1"
                            onClick={() => handleViewHtml(attempt.id)}
                          >
                            <Code className="mr-1 h-3 w-3" />
                            View HTML
                          </Button>
                          {rawHtmlState[attempt.id] && (
                            <div className="mt-2 overflow-auto max-h-[200px] rounded border bg-muted p-2">
                              {rawHtmlState[attempt.id].loading ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                  Loading...
                                </div>
                              ) : (
                                <pre className="text-xs whitespace-pre-wrap font-mono break-words">
                                  {rawHtmlState[attempt.id].html}
                                </pre>
                              )}
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
      </DialogContent>
    </Dialog>
  )
}
