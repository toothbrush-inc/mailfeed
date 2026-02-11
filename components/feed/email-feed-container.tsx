"use client"

import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useEmails } from "@/hooks/use-emails"
import { EmailFeedItem } from "./email-feed-item"
import { EmailFeedSkeleton } from "./email-feed-skeleton"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

export function EmailFeedContainer() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const tag = searchParams.get("tag")
  const search = searchParams.get("search")
  const page = parseInt(searchParams.get("page") || "1")

  const { emails, pagination, isLoading, error, mutate } = useEmails({ tag, search, page })

  const navigateToPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString())
    if (newPage === 1) {
      params.delete("page")
    } else {
      params.set("page", newPage.toString())
    }
    const queryString = params.toString()
    router.push(`${pathname}${queryString ? `?${queryString}` : ""}`)
  }

  if (isLoading) {
    return <EmailFeedSkeleton />
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950">
        <p className="text-red-600 dark:text-red-400">
          Failed to load emails. Please try again.
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

  if (emails.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-12 text-center dark:bg-zinc-900">
        <div className="mx-auto max-w-md">
          <h3 className="text-lg font-semibold">No emails found</h3>
          <p className="mt-2 text-muted-foreground">
            {search
              ? `No emails found matching "${search}".`
              : tag
              ? `No emails found with the "${tag.replace(/_/g, " ")}" tag.`
              : "Click the \"Sync Emails\" button to fetch emails you've sent to yourself."}
          </p>
        </div>
      </div>
    )
  }

  const renderPagination = (position: 'top' | 'bottom') => {
    if (!pagination) return null

    // Show pagination controls only if multiple pages
    if (pagination.totalPages > 1) {
      return (
        <div className={`flex items-center justify-between ${position === 'bottom' ? 'border-t pt-4 mt-4' : 'mb-4'}`}>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToPage(page - 1)}
            disabled={page <= 1}
          >
            <ChevronLeft className="h-4 w-4 mr-1" />
            Previous
          </Button>

          <p className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
            <span className="hidden sm:inline"> ({pagination.total} emails)</span>
          </p>

          <Button
            variant="outline"
            size="sm"
            onClick={() => navigateToPage(page + 1)}
            disabled={page >= pagination.totalPages}
          >
            Next
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )
    }

    // Show results count only (no pagination controls)
    if (position === 'top') {
      return (
        <div className="mb-4 text-center">
          <p className="text-sm text-muted-foreground">
            {pagination.total} {pagination.total === 1 ? 'email' : 'emails'}
          </p>
        </div>
      )
    }

    return null
  }

  return (
    <div className="space-y-4">
      {renderPagination('top')}

      {emails.map((email) => (
        <EmailFeedItem key={email.id} email={email} onIngestComplete={mutate} />
      ))}

      {renderPagination('bottom')}
    </div>
  )
}
