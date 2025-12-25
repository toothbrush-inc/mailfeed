"use client"

import useSWR from "swr"

interface Category {
  id: string
  name: string
  slug: string
  description: string | null
  color: string | null
  icon: string | null
  _count?: {
    links: number
  }
}

interface CategoriesResponse {
  categories: Category[]
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useCategories() {
  const { data, error, isLoading, mutate } = useSWR<CategoriesResponse>(
    "/api/categories",
    fetcher
  )

  return {
    categories: data?.categories || [],
    isLoading,
    error,
    mutate,
  }
}
