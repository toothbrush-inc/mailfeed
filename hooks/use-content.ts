"use client"

import useSWR from "swr"

interface ContentLink {
  id: string
  url: string
  finalUrl: string | null
  domain: string | null
  finalDomain: string | null
  title: string | null
  imageUrl: string | null
  contentText: string | null
  rawHtml: string | null
  aiSummary: string | null
  readingTimeMin: number | null
  wordCount: number | null
  isHighlighted: boolean
  isRead: boolean
  createdAt: string
  email: {
    receivedAt: string
  } | null
}

interface ContentResponse {
  links: ContentLink[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useContent(page: number = 1) {
  const { data, error, isLoading, mutate } = useSWR<ContentResponse>(
    `/api/content?page=${page}`,
    fetcher
  )

  return {
    links: data?.links || [],
    pagination: data?.pagination,
    isLoading,
    error,
    mutate,
  }
}
