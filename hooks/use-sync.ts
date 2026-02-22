"use client"

import { useState, useCallback } from "react"
import { useSWRConfig } from "swr"
import useSWR from "swr"

type SyncMode = "check-new" | "load-more" | "initial" | "full-resync"

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
  hasMoreHistory: boolean
  gmailTotalEstimate?: number
  mode: SyncMode
  upToDate: boolean
  queryChanged: boolean
  newestEmailDate: string | null
  oldestEmailDate: string | null
  errors: string[]
}

interface SyncError {
  error: string
  code?: string
  requiresReauth?: boolean
}

interface SyncStatus {
  hasSynced: boolean
  emailCount: number
  lastSyncAt: string | null
  hasMoreHistory: boolean
  newestEmailDate: string | null
  oldestEmailDate: string | null
  syncQuery: string | null
  currentQuery: string
  queryMismatch: boolean
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useSync() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requiresReauth, setRequiresReauth] = useState(false)
  const [result, setResult] = useState<SyncResult | null>(null)
  const { mutate } = useSWRConfig()

  const { data: syncStatus, mutate: mutateSyncStatus } = useSWR<SyncStatus>(
    "/api/sync/status",
    fetcher
  )

  const runSync = useCallback(async (mode: SyncMode) => {
    setIsLoading(true)
    setError(null)
    setRequiresReauth(false)

    try {
      const url = new URL("/api/sync", window.location.origin)
      url.searchParams.set("mode", mode)

      const response = await fetch(url.toString(), {
        method: "POST",
      })

      if (!response.ok) {
        const data: SyncError = await response.json()

        if (data.requiresReauth) {
          setRequiresReauth(true)
          setError(data.error || "Please sign in again to continue syncing.")
          return null
        }

        throw new Error(data.error || "Sync failed")
      }

      const data: SyncResult = await response.json()
      setResult(data)

      // Invalidate caches to refresh the feed
      mutate("/api/links")
      mutate("/api/categories")
      mutate("/api/stats")
      mutate("/api/emails/stats")
      mutateSyncStatus()

      return data
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sync failed"
      setError(message)
      throw err
    } finally {
      setIsLoading(false)
    }
  }, [mutate, mutateSyncStatus])

  const checkNew = useCallback(() => runSync("check-new"), [runSync])
  const loadMore = useCallback(() => runSync("load-more"), [runSync])
  const initialSync = useCallback(() => runSync("initial"), [runSync])
  const fullResync = useCallback(() => runSync("full-resync"), [runSync])

  const clearReauthRequired = useCallback(() => {
    setRequiresReauth(false)
    setError(null)
  }, [])

  const hasMoreHistory = result?.hasMoreHistory ?? syncStatus?.hasMoreHistory ?? false
  const queryMismatch = result?.queryChanged ?? syncStatus?.queryMismatch ?? false

  return {
    checkNew,
    loadMore,
    initialSync,
    fullResync,
    isLoading,
    error,
    result,
    requiresReauth,
    clearReauthRequired,
    hasMoreHistory,
    queryMismatch,
    syncStatus,
  }
}
