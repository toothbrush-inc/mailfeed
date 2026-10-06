"use client"

import { useCallback, useRef, useState } from "react"
import useSWR from "swr"
import type { MediaType } from "@/lib/media"
import type { MediaItem, MediaListResult } from "@/lib/media-list"
import type { MediaRescanResult } from "@/lib/media-rescan"

export type { MediaItem }

export interface MediaResponse extends MediaListResult {
  lookups: {
    /** Posts and pages waiting for a media lookup. */
    pending: number
    /** Why video lookups can't run, or null when they can. */
    unavailable: string | null
  }
}

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`Media request failed: ${res.status}`)
    return res.json()
  })

export function useMedia(type: MediaType | null, search: string, page: number) {
  const params = new URLSearchParams()
  if (type) params.set("type", type)
  if (search) params.set("search", search)
  if (page > 1) params.set("page", String(page))

  const { data, error, isLoading, mutate } = useSWR<MediaResponse>(
    `/api/media?${params}`,
    fetcher,
    // Keep the counts on screen while switching types
    { keepPreviousData: true }
  )

  // Rows from the previous type or page are stale while the new one loads
  const isCurrent = data?.type === type && data.pagination.page === page

  return {
    data,
    items: isCurrent && data ? data.items : [],
    isLoading: isLoading || (!!data && !isCurrent),
    error,
    mutate,
  }
}

export interface RescanProgress {
  running: boolean
  /** Posts and videos looked at so far, and how many are left. */
  scanned: number
  remaining: number
  linksFound: number
  titlesFilled: number
  addressesCleaned: number
  finished: boolean
  error: string | null
}

const IDLE: RescanProgress = {
  running: false,
  scanned: 0,
  remaining: 0,
  linksFound: 0,
  titlesFilled: 0,
  addressesCleaned: 0,
  finished: false,
  error: null,
}

/**
 * Drives POST /api/media/rescan to the end, one short request at a time.
 * `onProgress` runs after each request that found something. A scan that
 * was stopped or failed part-way picks up where it left off.
 */
export function useMediaRescan(onProgress: () => void) {
  const [progress, setProgress] = useState<RescanProgress>(IDLE)
  const stopRequested = useRef(false)
  // Where an unfinished scan got to, with its totals so far
  const resume = useRef<{ cursor: string; totals: RescanProgress } | null>(null)

  const start = useCallback(async () => {
    stopRequested.current = false
    let totals: RescanProgress = { ...(resume.current?.totals ?? IDLE), running: true, error: null }
    setProgress(totals)

    let cursor: string | null = resume.current?.cursor ?? null
    try {
      while (!stopRequested.current) {
        const response = await fetch("/api/media/rescan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cursor }),
        })
        if (!response.ok) throw new Error(`Rescan failed: ${response.status}`)
        const step: MediaRescanResult = await response.json()

        totals = {
          ...totals,
          scanned: totals.scanned + step.scanned,
          remaining: step.remaining,
          linksFound: totals.linksFound + step.linksFound,
          titlesFilled: totals.titlesFilled + step.titlesFilled,
          addressesCleaned: totals.addressesCleaned + step.addressesCleaned,
        }
        setProgress(totals)
        if (step.linksFound > 0 || step.titlesFilled > 0) onProgress()

        if (step.done) {
          totals = { ...totals, finished: true }
          resume.current = null
          break
        }
        cursor = step.cursor
        if (cursor) resume.current = { cursor, totals: { ...totals, running: false } }
      }
      setProgress({ ...totals, running: false })
    } catch (error) {
      setProgress({
        ...totals,
        running: false,
        error: error instanceof Error ? error.message : "Rescan failed",
      })
    }
  }, [onProgress])

  const stop = useCallback(() => {
    stopRequested.current = true
  }, [])

  return { progress, start, stop }
}

export interface LookupProgress {
  running: boolean
  processed: number
  found: number
  remaining: number
  error: string | null
}

const LOOKUPS_IDLE: LookupProgress = { running: false, processed: 0, found: 0, remaining: 0, error: null }

/**
 * Runs the media lookup for every post or page waiting for one, a couple
 * per request (POST /api/media/lookups), until none are left or it is stopped.
 */
export function useLookups(onProgress: () => void) {
  const [progress, setProgress] = useState<LookupProgress>(LOOKUPS_IDLE)
  const stopRequested = useRef(false)

  const start = useCallback(async () => {
    stopRequested.current = false
    let totals: LookupProgress = { ...LOOKUPS_IDLE, running: true }
    setProgress(totals)
    try {
      while (!stopRequested.current) {
        const response = await fetch("/api/media/lookups", { method: "POST" })
        const step = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(step.error || `Lookup failed: ${response.status}`)

        totals = {
          ...totals,
          processed: totals.processed + step.processed,
          found: totals.found + step.found,
          remaining: step.remaining,
        }
        setProgress(totals)
        if (step.processed > 0) onProgress()
        if (step.remaining === 0 || step.processed === 0) break
      }
      setProgress({ ...totals, running: false })
    } catch (error) {
      setProgress({ ...totals, running: false, error: error instanceof Error ? error.message : "Lookup failed" })
    }
  }, [onProgress])

  const stop = useCallback(() => {
    stopRequested.current = true
  }, [])

  return { progress, start, stop }
}
