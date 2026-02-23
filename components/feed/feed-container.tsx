"use client"

import { useState } from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { useLinks } from "@/hooks/use-links"
import { useDomains } from "@/hooks/use-domains"
import { FeedItem } from "./feed-item"
import { FeedSkeleton } from "./feed-skeleton"
import { Pagination } from "./pagination"
import { Button } from "@/components/ui/button"
import { AddLinkButton } from "@/components/add-link-button"
import { ChevronsDownUp, ChevronsUpDown } from "lucide-react"

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
  const sort = searchParams.get("sort")
  const page = parseInt(searchParams.get("page") || "1")

  const { links, pagination, isLoading, error, mutate } = useLinks({
    category,
    tag,
    domain,
    highlighted,
    read: readFilter || "all",
    search,
    sort,
    page,
  })

  const [allExpanded, setAllExpanded] = useState(false)
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
              : "Click the \"Sync\" button to fetch links."}
          </p>
          <div className="mt-4">
            <AddLinkButton onSuccess={mutate} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Top bar with pagination info and add button */}
      <div className="flex items-center justify-between">
        {pagination && (
          <Pagination
            page={page}
            totalPages={pagination.totalPages}
            total={pagination.total}
            limit={pagination.limit}
            onPageChange={navigateToPage}
            compact
          />
        )}
        {!pagination && <div />}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAllExpanded((prev) => !prev)}
          >
            {allExpanded ? (
              <>
                <ChevronsDownUp className="mr-1.5 h-4 w-4" />
                Collapse All
              </>
            ) : (
              <>
                <ChevronsUpDown className="mr-1.5 h-4 w-4" />
                Expand All
              </>
            )}
          </Button>
          <AddLinkButton onSuccess={mutate} />
        </div>
      </div>

      {links.map((link) => (
        <FeedItem
          key={link.id}
          link={link}
          searchTerm={search || undefined}
          expanded={allExpanded}
          onAnalyzeComplete={mutate}
          onHideDomain={handleHideDomain}
        />
      ))}

      {/* Bottom pagination */}
      {pagination && (
        <Pagination
          page={page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          limit={pagination.limit}
          onPageChange={navigateToPage}
        />
      )}
    </div>
  )
}
