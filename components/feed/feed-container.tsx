"use client"

import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useLinks } from "@/hooks/use-links"
import { useDomains } from "@/hooks/use-domains"
import { FeedItem } from "./feed-item"
import { FeedSkeleton } from "./feed-skeleton"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

export function FeedContainer() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const category = searchParams.get("category")
  const tag = searchParams.get("tag")
  const domain = searchParams.get("domain")
  const highlighted = searchParams.get("highlighted") === "true"
  const readFilter = searchParams.get("read") as "all" | "read" | "unread" | null
  const search = searchParams.get("search")
  const page = parseInt(searchParams.get("page") || "1")

  const { links, pagination, isLoading, error, mutate } = useLinks({
    category,
    tag,
    domain,
    highlighted,
    read: readFilter || "all",
    search,
    page,
  })

  const { hideDomain } = useDomains()

  const handleHideDomain = async (domainToHide: string) => {
    await hideDomain(domainToHide)
    mutate() // Refresh the links list after hiding a domain
  }

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
          <h3 className="text-lg font-semibold">No links found</h3>
          <p className="mt-2 text-muted-foreground">
            {search
              ? `No links matching "${search}". Try a different search term.`
              : readFilter === "unread"
              ? "No unread links. You're all caught up!"
              : readFilter === "read"
              ? "No read links yet. Start reading some articles!"
              : highlighted
              ? "No highlighted articles found. Check back after syncing more emails."
              : category
              ? `No articles found in the "${category}" category.`
              : tag
              ? `No links found with the "${tag.replace(/_/g, " ")}" tag.`
              : domain
              ? `No links found from "${domain}".`
              : "Click the \"Sync Emails\" button to fetch links from emails you've sent to yourself."}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {links.map((link) => (
        <FeedItem
          key={link.id}
          link={link}
          onAnalyzeComplete={mutate}
          onHideDomain={handleHideDomain}
        />
      ))}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4 mt-4">
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
            <span className="hidden sm:inline"> ({pagination.total} links)</span>
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
      )}
    </div>
  )
}
