"use client"

import { Button } from "@/components/ui/button"
import { useSync } from "@/hooks/use-sync"
import { cn } from "@/lib/utils"

export function SyncButton() {
  const { sync, isLoading, result, error } = useSync()

  return (
    <div className="flex items-center gap-3">
      <Button onClick={() => sync()} disabled={isLoading} variant="outline" size="sm">
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
        {isLoading ? "Syncing..." : "Sync Emails"}
      </Button>

      {result && !isLoading && (
        <span className="text-xs text-muted-foreground">
          {result.linksExtracted} links found, {result.linksAnalyzed} analyzed
        </span>
      )}

      {error && (
        <span className="text-xs text-red-500">{error}</span>
      )}
    </div>
  )
}
