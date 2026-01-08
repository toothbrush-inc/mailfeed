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

interface SyncError {
  error: string
  code?: string
  requiresReauth?: boolean
}

export function useSync() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requiresReauth, setRequiresReauth] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const { mutate } = useSWRConfig()

  const sync = useCallback(async (options?: SyncOptions) => {
    setIsLoading(true)
    setError(null)
    setRequiresReauth(false)

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
        const data: SyncError = await response.json()

        // Check if re-authentication is required
        if (data.requiresReauth) {
          setRequiresReauth(true)
          setError(data.error || "Please sign in again to continue syncing.")
          return null
        }

        throw new Error(data.error || "Sync failed")
      }

      const data: SyncResult = await response.json()
      setResult(data)

      // Invalidate links and categories cache to refresh the feed
      mutate("/api/links")
      mutate("/api/categories")
      mutate("/api/stats")
      mutate("/api/emails/stats")

      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed"
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [mutate])

  const clearReauthRequired = useCallback(() => {
    setRequiresReauth(false)
    setError(null)
  }, [])

  return { sync, isLoading, error, result, requiresReauth, clearReauthRequired }
}
