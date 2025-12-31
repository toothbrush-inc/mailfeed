"use client"

import useSWR from "swr"

interface Domain {
  domain: string
  count: number
}

interface DomainsResponse {
  domains: Domain[]
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useDomains() {
  const { data, error, isLoading } = useSWR<DomainsResponse>("/api/domains", fetcher)

  return {
    domains: data?.domains || [],
    isLoading,
    error,
  }
}
