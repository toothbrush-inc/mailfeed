"use client"

import { useState, useCallback } from "react"
import { useSWRConfig } from "swr"

interface SyncResult {
  emailsProcessed: number
  linksExtracted: number
  linksFetched: number
  linksAnalyzed: number
  errors: string[]
}

export function useSync() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const { mutate } = useSWRConfig()

  const sync = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/sync", {
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
