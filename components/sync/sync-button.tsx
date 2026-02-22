"use client"

import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { useSync } from "@/hooks/use-sync"
import { cn } from "@/lib/utils"
import { AlertTriangle, LogIn, MoreVertical, ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function formatCoverageDate(iso: string | null | undefined): string {
  if (!iso) return ""
  const d = new Date(iso)
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" })
}

export function SyncButton() {
  const {
    checkNew, loadMore, initialSync, fullResync,
    isLoading, result, error, requiresReauth, clearReauthRequired,
    hasMoreHistory, queryMismatch, syncStatus,
  } = useSync()

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
  const emailCount = result?.emailsSynced ?? syncStatus?.emailCount ?? 0

  // Determine primary button behavior
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
        : "Check New"

  // Show re-auth prompt if required
  if (requiresReauth) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-2">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Google session expired
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Your Google authorization has expired or been revoked. Please sign in again to continue syncing emails.
            </p>
            <Button onClick={handleReauth} size="sm" variant="outline" className="mt-2">
              <LogIn className="mr-2 h-4 w-4" />
              Sign in with Google
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Query change warning */}
      {queryMismatch && (
        <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-800 dark:bg-amber-950">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Email query changed. Click <strong>Resync</strong> to sync with the new query.
          </p>
        </div>
      )}

      <div className="flex items-center gap-2">
        {/* Primary sync button */}
        <Button onClick={handlePrimary} disabled={isLoading} variant="outline" size="sm">
          <svg
            className={cn("mr-2 h-4 w-4", isLoading && "animate-spin")}
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
          {primaryLabel}
        </Button>

        {/* Load Older button */}
        {hasMoreHistory && !queryMismatch && hasSynced && (
          <Button onClick={loadMore} disabled={isLoading} variant="outline" size="sm">
            <ChevronDown className="mr-1 h-4 w-4" />
            Load Older
          </Button>
        )}

        {/* Overflow menu */}
        {hasSynced && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" disabled={isLoading}>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => fullResync()}>
                Full Resync
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Coverage line + result info */}
      {(emailCount > 0 || result) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {emailCount > 0 && (
            <span className="font-medium">
              {emailCount} emails synced
              {oldestDate && newestDate && (
                <> ({formatCoverageDate(oldestDate)} &ndash; {formatCoverageDate(newestDate)})</>
              )}
            </span>
          )}

          {!isLoading && result?.emailsProcessed != null && result.emailsProcessed > 0 && (
            <span>(+{result.emailsProcessed} new)</span>
          )}
          {!isLoading && result?.linksFetched != null && result.linksFetched > 0 && (
            <span>{result.linksFetched} links fetched</span>
          )}

          {!isLoading && result?.upToDate && (
            <span className="text-green-600">Up to date</span>
          )}

          {hasMoreHistory && (
            <span className="text-amber-600">More history available</span>
          )}
        </div>
      )}

      {error && !requiresReauth && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  )
}
