"use client"

import useSWR from "swr"

interface Link {
  id: string
  url: string
  title: string | null
  domain: string | null
  description: string | null
  imageUrl: string | null
  aiSummary: string | null
  aiKeyPoints: string[]
  aiCategory: string | null
  aiTags: string[]
  linkTags: string[]
  contentTags: string[]
  metadataTags: string[]
  readingTimeMin: number | null
  wordCount: number | null
  worthinessScore: number | null
  uniquenessScore: number | null
  isHighlighted: boolean
  highlightReason: string | null
  isPaywalled: boolean
  paywallType: string | null
  fetchStatus: string
  createdAt: string
  email: {
    gmailId: string
    subject: string | null
    receivedAt: string
  } | null
  categories: Array<{
    category: {
      id: string
      name: string
      slug: string
    }
  }>
}

interface LinksResponse {
  links: Link[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

interface UseLinksOptions {
  category?: string | null
  tag?: string | null
  highlighted?: boolean
  status?: string | null
  page?: number
  limit?: number
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useLinks(options: UseLinksOptions = {}) {
  const params = new URLSearchParams()

  if (options.category) params.set("category", options.category)
  if (options.tag) params.set("tag", options.tag)
  if (options.highlighted) params.set("highlighted", "true")
  if (options.status) params.set("status", options.status)
  if (options.page) params.set("page", options.page.toString())
  if (options.limit) params.set("limit", options.limit.toString())

  const queryString = params.toString()
  const url = `/api/links${queryString ? `?${queryString}` : ""}`

  const { data, error, isLoading, mutate } = useSWR<LinksResponse>(url, fetcher)

  return {
    links: data?.links || [],
    pagination: data?.pagination,
    isLoading,
    error,
    mutate,
  }
}
