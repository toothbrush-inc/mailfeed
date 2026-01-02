"use client"

import useSWR from "swr"

interface Stats {
  links: number
  highlighted: number
  emails: number
  domains: number
  withContent: number
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useStats() {
  const { data, error, isLoading, mutate } = useSWR<Stats>("/api/stats", fetcher)

  return {
    stats: data,
    isLoading,
    error,
    mutate,
  }
}
