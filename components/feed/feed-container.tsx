"use client"

import { useSearchParams } from "next/navigation"
import { useLinks } from "@/hooks/use-links"
import { FeedItem } from "./feed-item"
import { FeedSkeleton } from "./feed-skeleton"
import { Button } from "@/components/ui/button"

export function FeedContainer() {
  const searchParams = useSearchParams()

  const category = searchParams.get("category")
  const tag = searchParams.get("tag")
  const highlighted = searchParams.get("highlighted") === "true"

  const { links, pagination, isLoading, error } = useLinks({
    category,
    tag,
    highlighted,
  })

  if (isLoading) {
    return <FeedSkeleton />
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950">
        <p className="text-red-600 dark:text-red-400">
          Failed to load links. Please try again.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (links.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-12 text-center dark:bg-zinc-900">
        <div className="mx-auto max-w-md">
          <h3 className="text-lg font-semibold">No links yet</h3>
          <p className="mt-2 text-muted-foreground">
            {highlighted
              ? "No highlighted articles found. Check back after syncing more emails."
              : category
              ? `No articles found in the "${category}" category.`
              : "Click the \"Sync Emails\" button to fetch links from emails you've sent to yourself."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {links.map((link) => (
        <FeedItem key={link.id} link={link} />
      ))}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-4">
          <p className="text-sm text-muted-foreground">
            Showing {links.length} of {pagination.total} links
          </p>
        </div>
      )}
    </div>
  )
}
