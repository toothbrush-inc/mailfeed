"use client"

import useSWR from "swr"

interface Link {
  id: string
  url: string
  domain: string | null
  finalUrl: string | null
  finalDomain: string | null
  wasRedirected: boolean
  title: string | null
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
  contentSource: string | null
  archivedUrl: string | null
  contentText: string | null
  contentHtml: string | null
  rawHtml: string | null
  fetchError: string | null
  fetchedAt: string | null
  analyzedAt: string | null
  isRead: boolean
  readAt: string | null
  embeddingStatus: string | null
  embeddedAt: string | null
  embeddingError: string | null
  createdAt: string
  updatedAt: string
  email: {
    gmailId: string
    subject: string | null
    receivedAt: string
    rawContent: string | null
  } | null
  categories: Array<{
    category: {
      id: string
      name: string
      slug: string
    }
  }>
  childLinks: Array<{
    id: string
    url: string
    title: string | null
    domain: string | null
    finalUrl: string | null
    finalDomain: string | null
    aiSummary: string | null
    aiKeyPoints: string[]
    aiCategory: string | null
    aiTags: string[]
    linkTags: string[]
    contentTags: string[]
    metadataTags: string[]
    fetchStatus: string
    isHighlighted: boolean
    highlightReason: string | null
    isRead: boolean
    readingTimeMin: number | null
    imageUrl: string | null
    isPaywalled: boolean
    paywallType: string | null
    contentSource: string | null
    archivedUrl: string | null
    wordCount: number | null
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
  domain?: string | null
  highlighted?: boolean
  status?: string | null
  read?: "all" | "read" | "unread"
  search?: string | null
  sort?: string | null
  page?: number
  limit?: number
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useLinks(options: UseLinksOptions = {}) {
  const params = new URLSearchParams()

  if (options.category) params.set("category", options.category)
  if (options.tag) params.set("tag", options.tag)
  if (options.domain) params.set("domain", options.domain)
  if (options.highlighted) params.set("highlighted", "true")
  if (options.status) params.set("status", options.status)
  if (options.read && options.read !== "all") params.set("read", options.read)
  if (options.search) params.set("search", options.search)
  if (options.sort && options.sort !== "date_desc") params.set("sort", options.sort)
  if (options.page) params.set("page", options.page.toString())
  if (options.limit) params.set("limit", options.limit.toString())

  const queryString = params.toString()
  const url = `/api/links${queryString ? `?${queryString}` : ""}`

  const { data, error, isLoading, isValidating, mutate } = useSWR<LinksResponse>(
    url,
    fetcher,
    {
      keepPreviousData: false, // Clear data when URL changes (e.g., search)
    }
  )

  return {
    links: data?.links || [],
    pagination: data?.pagination,
    isLoading,
    isValidating,
    error,
    mutate,
  }
}
