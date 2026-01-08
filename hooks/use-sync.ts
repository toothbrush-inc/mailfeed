"use client"

import { useState, useCallback } from "react"
import { useSWRConfig } from "swr"

interface SyncResult {
  emailsProcessed: number
  emailsSynced: number
  linksExtracted: number
  linksFetched: number
  linksSkippedExcluded?: number
  linksSkippedDuplicate?: number
  linksSkippedHidden?: number
  nestedLinksCreated?: number
  nestedLinksFetched?: number
  pagesProcessed?: number
  pagesSkipped?: number
  hasMorePages?: boolean
  gmailTotalEstimate?: number
  errors: string[]
}

interface SyncOptions {
  fullSync?: boolean
  continueSync?: boolean
  resetSync?: boolean
}

export function useSync() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const { mutate } = useSWRConfig()

  const sync = useCallback(async (options?: SyncOptions) => {
    setIsLoading(true)
    setError(null)

    try {
      const url = new URL("/api/sync", window.location.origin)
      if (options?.fullSync) {
        url.searchParams.set("fullSync", "true")
      }
      if (options?.continueSync) {
        url.searchParams.set("continue", "true")
      }
      if (options?.resetSync) {
        url.searchParams.set("reset", "true")
      }

      const response = await fetch(url.toString(), {
        method: "POST",
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Sync failed")
      }

      const data: SyncResult = await response.json()
      setResult(data)

      // Invalidate links and categories cache to refresh the feed
      mutate("/api/links")
      mutate("/api/categories")
      mutate("/api/stats")

      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed"
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [mutate])

  return { sync, isLoading, error, result }
}
