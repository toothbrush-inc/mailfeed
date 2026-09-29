"use client"

import useSWR from "swr"

export interface AiUsageKindTotal {
  kind: string
  calls: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface AiUsage {
  days: number
  since: string
  timeZone: string
  trackingSince: string | null
  totalUsd: number
  unpricedCalls: number
  analyzedLinks: number
  costPerLinkUsd: number | null
  byKind: AiUsageKindTotal[]
  daily: Array<{ date: string; costUsd: number; calls: number }>
}

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error(`AI usage request failed: ${res.status}`)
    return res.json()
  })

export function useAiUsage(days: number) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const { data, error, isLoading } = useSWR<AiUsage>(
    `/api/ai-usage?days=${days}&tz=${encodeURIComponent(tz)}`,
    fetcher
  )
  return { usage: data, error, isLoading }
}
