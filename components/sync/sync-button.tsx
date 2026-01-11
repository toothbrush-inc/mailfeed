"use client"

import { signIn } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { useSync } from "@/hooks/use-sync"
import { cn } from "@/lib/utils"
import { AlertTriangle, LogIn } from "lucide-react"

export function SyncButton() {
  const { sync, isLoading, result, error, requiresReauth, clearReauthRequired, hasMorePages, syncStatus } = useSync()

  const handleSync = () => sync()
  const handleContinueSync = () => sync({ continueSync: true })
  const handleResetSync = () => sync({ resetSync: true })

  const handleReauth = async () => {
    // Clear old tokens first
    try {
      await fetch("/api/auth/clear-tokens", { method: "POST" })
    } catch (e) {
      console.error("Failed to clear tokens:", e)
    }
    clearReauthRequired()
    signIn("google", { callbackUrl: window.location.href })
  }

  // Show "Sync Older" if there are more pages (from recent result or persisted status)
  const showSyncOlder = hasMorePages

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
      <div className="flex items-center gap-2">
        <Button onClick={handleSync} disabled={isLoading} variant="outline" size="sm">
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
          {isLoading ? "Syncing..." : "Sync New"}
        </Button>

        {showSyncOlder && (
          <Button onClick={handleContinueSync} disabled={isLoading} variant="outline" size="sm">
            Sync Older
          </Button>
        )}
      </div>

      {(result || syncStatus) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {/* Total emails synced */}
          {(result?.emailsSynced ?? syncStatus?.emailCount ?? 0) > 0 && (
            <span className="font-medium">{result?.emailsSynced ?? syncStatus?.emailCount} emails synced</span>
          )}
          {/* Last sync details */}
          {!isLoading && result?.emailsProcessed && result.emailsProcessed > 0 && (
            <span>(+{result.emailsProcessed} new)</span>
          )}
          {!isLoading && result?.linksFetched && result.linksFetched > 0 && (
            <span>{result.linksFetched} links fetched</span>
          )}
          {hasMorePages && (
            <span className="text-amber-600">More history available</span>
          )}
          {!isLoading && !hasMorePages && syncStatus?.emailCount && syncStatus.emailCount > 0 && (
            <button
              onClick={handleResetSync}
              className="text-blue-600 hover:underline"
            >
              Restart from beginning
            </button>
          )}
        </div>
      )}

      {error && !requiresReauth && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  )
}
