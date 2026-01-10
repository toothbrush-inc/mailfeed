"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useDomains } from "@/hooks/use-domains"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Filter, X, ChevronDown, Loader2 } from "lucide-react"

// Link type tags from BAML LinkTag enum
const LINK_TAGS = [
  { value: "ARTICLE", label: "Article" },
  { value: "VIDEO", label: "Video" },
  { value: "IMAGE", label: "Image" },
  { value: "AUDIO", label: "Audio" },
  { value: "REAL_TIME_CHAT", label: "Chat" },
]

// Content tags from BAML ContentTag enum
const CONTENT_TAGS = [
  { value: "TECHNOLOGY", label: "Technology" },
  { value: "BUSINESS", label: "Business" },
  { value: "SCIENCE", label: "Science" },
  { value: "HEALTH", label: "Health" },
  { value: "POLITICS", label: "Politics" },
  { value: "CULTURE", label: "Culture" },
  { value: "FINANCE", label: "Finance" },
  { value: "SELF_IMPROVEMENT", label: "Self Improvement" },
  { value: "NEWS", label: "News" },
  { value: "OPINION", label: "Opinion" },
  { value: "TUTORIAL", label: "Tutorial" },
  { value: "RESEARCH", label: "Research" },
  { value: "FUN", label: "Fun" },
  { value: "HISTORY", label: "History" },
  { value: "ART", label: "Art" },
  { value: "MUSIC", label: "Music" },
  { value: "MOVIE", label: "Movie" },
  { value: "TV", label: "TV" },
  { value: "GAME", label: "Game" },
]

// Metadata tags from BAML MetadataTags enum
const METADATA_TAGS = [
  { value: "OPEN_ACCESS", label: "Open Access" },
  { value: "LOGIN_REQUIRED", label: "Login Required" },
  { value: "PAYMENT_REQUIRED", label: "Paywall" },
  { value: "SUBSCRIPTION_REQUIRED", label: "Subscription" },
]

// Read status filter options
const READ_STATUS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "read", label: "Read" },
]

// All tags combined for lookup
const ALL_TAGS = [...LINK_TAGS, ...CONTENT_TAGS, ...METADATA_TAGS]

export function LinkTagFilter() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const [filterOpen, setFilterOpen] = useState(false)

  const currentTag = searchParams.get("tag")
  const currentDomain = searchParams.get("domain")
  const currentRead = searchParams.get("read") || "all"

  const { domains, isLoading: domainsLoading } = useDomains()
  const visibleDomains = domains.filter((d) => !d.isHidden).slice(0, 20)

  // Check if any filters are active
  const hasActiveFilters = currentTag || currentDomain

  // Get the label for a tag value
  const getTagLabel = (value: string) => {
    const tag = ALL_TAGS.find((t) => t.value === value)
    return tag?.label || value.replace(/_/g, " ")
  }

  // Build URL with updated params
  const buildUrl = (updates: Record<string, string | null>) => {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null) {
        params.delete(key)
      } else {
        params.set(key, value)
      }
    }
    params.delete("page") // Reset to page 1 when changing filters
    const queryString = params.toString()
    return `${pathname}${queryString ? `?${queryString}` : ""}`
  }

  const handleFilterSelect = (type: "tag" | "domain", value: string) => {
    router.push(buildUrl({ [type]: value }))
    setFilterOpen(false)
  }

  const handleClearFilter = (type: "tag" | "domain") => {
    router.push(buildUrl({ [type]: null }))
  }

  const handleReadChange = (value: string) => {
    router.push(buildUrl({ read: value === "all" ? null : value }))
  }

  const renderTagGroup = (
    title: string,
    tags: { value: string; label: string }[],
    type: "tag" | "domain" = "tag"
  ) => (
    <div className="space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {title}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <button
            key={tag.value}
            onClick={() => handleFilterSelect(type, tag.value)}
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              (type === "tag" ? currentTag : currentDomain) === tag.value
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            )}
          >
            {tag.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {/* Read status quick filters */}
      <div className="flex items-center gap-1 mr-2">
        {READ_STATUS.map((status) => (
          <button
            key={status.value}
            onClick={() => handleReadChange(status.value)}
            className={cn(
              "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
              currentRead === status.value
                ? "bg-blue-600 text-white dark:bg-blue-500"
                : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            )}
          >
            {status.label}
          </button>
        ))}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-zinc-300 dark:bg-zinc-600" />

      {/* Active filters as removable badges */}
      {currentTag && (
        <div className="flex items-center gap-1 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 pl-2.5 pr-1 py-0.5">
          <span className="text-xs font-medium">{getTagLabel(currentTag)}</span>
          <button
            onClick={() => handleClearFilter("tag")}
            className="ml-0.5 rounded-full p-0.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {currentDomain && (
        <div className="flex items-center gap-1 rounded-full bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 pl-2.5 pr-1 py-0.5">
          <span className="text-xs font-medium">{currentDomain}</span>
          <button
            onClick={() => handleClearFilter("domain")}
            className="ml-0.5 rounded-full p-0.5 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Clear all button */}
      {hasActiveFilters && (
        <Link
          href="/feed"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Clear all
        </Link>
      )}

      {/* Filter dropdown button */}
      <Popover open={filterOpen} onOpenChange={setFilterOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1.5">
            <Filter className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filters</span>
            <ChevronDown className="h-3 w-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-4" align="start">
          <div className="space-y-4">
            {renderTagGroup("Type", LINK_TAGS)}
            {renderTagGroup("Topic", CONTENT_TAGS)}
            {renderTagGroup("Access", METADATA_TAGS)}

            {/* Domain filter */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Domain
              </span>
              {domainsLoading ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading...
                </div>
              ) : visibleDomains.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
                  {visibleDomains.map(({ domain, count }) => (
                    <button
                      key={domain}
                      onClick={() => handleFilterSelect("domain", domain)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                        currentDomain === domain
                          ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                          : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                      )}
                    >
                      {domain}
                      <span className="text-[10px] opacity-60">({count})</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">No domains yet</p>
              )}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
