"use client"

import { useState, useEffect } from "react"
import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { useSync } from "@/hooks/use-sync"
import { cn } from "@/lib/utils"
import { AlertTriangle, LogIn, ChevronDown, RefreshCw, History, RotateCcw } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function formatCoverageDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHr = Math.floor(diffMin / 60)
  const diffDays = Math.floor(diffHr / 24)

  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      className={cn("h-4 w-4", spinning && "animate-spin")}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  )
}

export function SyncButton() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const {
    checkNew, loadMore, initialSync, fullResync,
    isLoading, result, error, requiresReauth, clearReauthRequired,
    hasMoreHistory, queryMismatch, syncStatus,
  } = useSync()

  if (!mounted) return null

  const handleReauth = async () => {
    try {
      await fetch("/api/auth/clear-tokens", { method: "POST" })
    } catch (e) {
      console.error("Failed to clear tokens:", e)
    }
    clearReauthRequired()
    signIn("google", { callbackUrl: window.location.href })
  }

  const hasSynced = syncStatus?.hasSynced ?? false
  const newestDate = result?.newestEmailDate ?? syncStatus?.newestEmailDate
  const oldestDate = result?.oldestEmailDate ?? syncStatus?.oldestEmailDate
  const lastSyncAt = syncStatus?.lastSyncAt
  const emailCount = result?.emailsSynced ?? syncStatus?.emailCount ?? 0

  const handlePrimary = () => {
    if (queryMismatch || !hasSynced) {
      initialSync()
    } else {
      checkNew()
    }
  }

  const primaryLabel = isLoading
    ? "Syncing..."
    : queryMismatch
      ? "Resync"
      : !hasSynced
        ? "Start Sync"
        : "Sync"

  // Show re-auth prompt if required
  if (requiresReauth) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 dark:border-amber-800 dark:bg-amber-950">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
        <span className="text-xs text-amber-700 dark:text-amber-300">
          Google session expired
        </span>
        <Button onClick={handleReauth} size="sm" variant="outline" className="h-7 text-xs">
          <LogIn className="mr-1.5 h-3.5 w-3.5" />
          Reconnect
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {/* Query change warning */}
      {queryMismatch && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Email query changed. Click <strong>Resync</strong> to sync with the new query.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        {/* Split button: primary action + dropdown */}
        <div className="flex items-center">
          <Button
            onClick={handlePrimary}
            disabled={isLoading}
            variant="outline"
            size="sm"
            className="rounded-r-none border-r-0"
          >
            <SyncIcon spinning={isLoading} />
            <span className="ml-2">{primaryLabel}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="rounded-l-none px-2"
                disabled={isLoading}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onClick={() => checkNew()} disabled={!hasSynced || queryMismatch}>
                <div className="flex items-start gap-2">
                  <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div>Check for new emails</div>
                    {lastSyncAt && (
                      <div className="text-xs text-muted-foreground">
                        Last checked {formatRelativeTime(lastSyncAt)}
                      </div>
                    )}
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => loadMore()} disabled={!hasSynced || queryMismatch}>
                <div className="flex items-start gap-2">
                  <History className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <div>Load older emails</div>
                    {oldestDate && (
                      <div className="text-xs text-muted-foreground">
                        Synced back to {formatCoverageDate(oldestDate)}
                      </div>
                    )}
                  </div>
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => fullResync()}>
                <div className="flex items-start gap-2">
                  <RotateCcw className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>Full resync</div>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Last sync result feedback */}
        {!isLoading && result?.upToDate && (
          <span className="text-xs text-green-600">Up to date</span>
        )}
        {!isLoading && result?.emailsProcessed != null && result.emailsProcessed > 0 && (
          <span className="text-xs text-muted-foreground">
            +{result.emailsProcessed} emails, {result.linksFetched ?? 0} links
          </span>
        )}
      </div>

      {/* Stats line */}
      {emailCount > 0 && (
        <div className="text-xs text-muted-foreground">
          {emailCount} emails
          {oldestDate && newestDate && (
            <> &middot; {formatCoverageDate(oldestDate)} &ndash; {formatCoverageDate(newestDate)}</>
          )}
          {lastSyncAt && (
            <> &middot; synced {formatRelativeTime(lastSyncAt)}</>
          )}
        </div>
      )}

      {error && !requiresReauth && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  )
}
