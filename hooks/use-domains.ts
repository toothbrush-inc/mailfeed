"use client"

import useSWR from "swr"

interface Domain {
  domain: string
  count: number
  isHidden: boolean
}

interface DomainsResponse {
  domains: Domain[]
  hiddenDomains: string[]
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useDomains() {
  const { data, error, isLoading, mutate } = useSWR<DomainsResponse>("/api/domains", fetcher)

  const hideDomain = async (domain: string) => {
    const response = await fetch("/api/domains", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    })
    if (response.ok) {
      mutate()
    }
    return response.ok
  }

  const unhideDomain = async (domain: string) => {
    const response = await fetch("/api/domains", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain }),
    })
    if (response.ok) {
      mutate()
    }
    return response.ok
  }

  return {
    domains: data?.domains || [],
    hiddenDomains: data?.hiddenDomains || [],
    isLoading,
    error,
    hideDomain,
    unhideDomain,
    mutate,
  }
}
