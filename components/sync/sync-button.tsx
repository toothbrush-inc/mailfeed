"use client"

import { Button } from "@/components/ui/button"
import { useSync } from "@/hooks/use-sync"
import { cn } from "@/lib/utils"

export function SyncButton() {
  const { sync, isLoading, result, error } = useSync()

  const handleSync = () => sync()
  const handleContinueSync = () => sync({ continueSync: true })
  const handleResetSync = () => sync({ resetSync: true })

  // Show "Sync Older" if there are more pages OR if we have a result with estimated emails
  const showSyncOlder = result?.hasMorePages

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

      {result && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {/* Total emails synced */}
          {result.emailsSynced > 0 && (
            <span className="font-medium">{result.emailsSynced} emails synced</span>
          )}
          {/* Last sync details */}
          {!isLoading && result.emailsProcessed > 0 && (
            <span>(+{result.emailsProcessed} new)</span>
          )}
          {!isLoading && result.linksFetched > 0 && (
            <span>{result.linksFetched} links fetched</span>
          )}
          {result.hasMorePages && (
            <span className="text-amber-600">More history available</span>
          )}
          {!isLoading && !result.hasMorePages && result.gmailTotalEstimate && result.gmailTotalEstimate > 0 && (
            <button
              onClick={handleResetSync}
              className="text-blue-600 hover:underline"
            >
              Restart from beginning
            </button>
          )}
        </div>
      )}

      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  )
}
