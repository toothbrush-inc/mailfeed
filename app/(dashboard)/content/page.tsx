"use client"

import { useState } from "react"
import { useContent } from "@/hooks/use-content"
import { ContentCard } from "@/components/feed/content-card"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react"

export default function ContentFeedPage() {
  const [page, setPage] = useState(1)
  const { links, pagination, isLoading, error } = useContent(page)

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Content Feed</h2>
          <p className="text-muted-foreground">
            Read article content directly in your feed.
          </p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Content Feed</h2>
          <p className="text-muted-foreground">
            Read article content directly in your feed.
          </p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950">
          <p className="text-red-600 dark:text-red-400">
            Failed to load content. Please try again.
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
      </div>
    )
  }

  if (links.length === 0) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-6">
          <h2 className="text-2xl font-bold">Content Feed</h2>
          <p className="text-muted-foreground">
            Read article content directly in your feed.
          </p>
        </div>
        <div className="rounded-lg border bg-white p-12 text-center dark:bg-zinc-900">
          <div className="mx-auto max-w-md">
            <h3 className="text-lg font-semibold">No content available</h3>
            <p className="mt-2 text-muted-foreground">
              Articles with readable content will appear here once they&apos;re fetched and processed.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Content Feed</h2>
        <p className="text-muted-foreground">
          Read article content directly in your feed.
        </p>
      </div>

      <div className="space-y-6">
        {links.map((link) => (
          <ContentCard key={link.id} link={link} />
        ))}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4 mt-6">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>

          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
            <span className="hidden sm:inline"> ({pagination.total} articles)</span>
          </p>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= pagination.totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  )
}
