"use client"

import useSWR from "swr"

interface EmailLink {
  id: string
  url: string
  title: string | null
  domain: string | null
  aiSummary: string | null
  aiCategory: string | null
  aiTags: string[]
  fetchStatus: string
  isHighlighted: boolean
}

interface Email {
  id: string
  gmailId: string
  subject: string | null
  snippet: string | null
  receivedAt: string
  links: EmailLink[]
}

interface EmailsResponse {
  emails: Email[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

interface UseEmailsOptions {
  page?: number
  limit?: number
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useEmails(options: UseEmailsOptions = {}) {
  const params = new URLSearchParams()

  if (options.page) params.set("page", options.page.toString())
  if (options.limit) params.set("limit", options.limit.toString())

  const queryString = params.toString()
  const url = `/api/emails${queryString ? `?${queryString}` : ""}`

  const { data, error, isLoading, mutate } = useSWR<EmailsResponse>(url, fetcher)

  return {
    emails: data?.emails || [],
    pagination: data?.pagination,
    isLoading,
    error,
    mutate,
  }
}
