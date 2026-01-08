"use client"

import useSWR from "swr"

interface DailyCount {
  date: string
  count: number
}

interface EmailStatsResponse {
  daily: DailyCount[]
  total: number
  periodTotal: number
  periodStart: string
  periodEnd: string
  days: number
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useEmailStats(days: number = 30) {
  const { data, error, isLoading } = useSWR<EmailStatsResponse>(
    `/api/emails/stats?days=${days}`,
    fetcher
  )

  return {
    stats: data,
    isLoading,
    error,
  }
}
