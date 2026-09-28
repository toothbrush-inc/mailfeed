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
        <span className="hidden text-xs text-amber-700 sm:inline dark:text-amber-300">
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
        // Too tall for the phone header; there the button shows a warning icon instead
        <div className="hidden items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 md:flex dark:border-amber-800 dark:bg-amber-950">
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
            {queryMismatch && (
              <AlertTriangle
                className="ml-1 h-3.5 w-3.5 text-amber-600 md:hidden dark:text-amber-400"
                aria-label="Email query changed; resync needed"
              />
            )}
            {/* Icon-only on phones; the label would crowd the header. */}
            <span className="ml-2 hidden sm:inline">{primaryLabel}</span>
            <span className="sr-only sm:hidden">{primaryLabel}</span>
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
          <span className="hidden text-xs text-green-600 sm:inline">Up to date</span>
        )}
        {!isLoading && result?.emailsProcessed != null && result.emailsProcessed > 0 && (
          <span className="hidden text-xs text-muted-foreground sm:inline">
            +{result.emailsProcessed} emails, {result.linksFetched ?? 0} links
          </span>
        )}
      </div>

      {/* Stats line. Hidden on phones, where it wrapped past the 64px header;
          the dropdown still shows last checked and synced-back-to. */}
      {emailCount > 0 && (
        <div className="hidden text-xs text-muted-foreground md:block">
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
        <span className="max-w-[9rem] truncate text-xs text-red-500 md:max-w-none" title={error}>
          {error}
        </span>
      )}
    </div>
  )
}
