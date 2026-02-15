"use client"

import useSWR from "swr"

interface FetchAttempt {
  id: string
  operationId: string
  fetcherId: string
  fetcherName: string | null
  trigger: string
  sequence: number
  success: boolean
  error: string | null
  httpStatus: number | null
  durationMs: number
  createdAt: string
}

interface FetchAttemptsResponse {
  attempts: FetchAttempt[]
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useFetchAttempts(linkId: string | null) {
  const { data, error, isLoading } = useSWR<FetchAttemptsResponse>(
    linkId ? `/api/links/${linkId}/attempts` : null,
    fetcher
  )

  return {
    attempts: data?.attempts || [],
    isLoading,
    error,
  }
}
