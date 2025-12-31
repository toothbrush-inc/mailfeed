"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { DomainFilter } from "./domain-filter"

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

export function LinkTagFilter() {
  const searchParams = useSearchParams()
  const currentTag = searchParams.get("tag")

  const renderTagGroup = (
    title: string,
    tags: { value: string; label: string }[]
  ) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground font-medium min-w-[70px]">
        {title}:
      </span>
      {tags.map((tag) => (
        <Link
          key={tag.value}
          href={`/feed?tag=${tag.value}`}
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
            currentTag === tag.value
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          )}
        >
          {tag.label}
        </Link>
      ))}
    </div>
  )

  return (
    <div className="space-y-2 mb-6 p-4 rounded-lg border bg-white dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <Link
          href="/feed"
          className={cn(
            "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-colors",
            !currentTag
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          )}
        >
          All
        </Link>
      </div>

      {renderTagGroup("Type", LINK_TAGS)}
      {renderTagGroup("Content", CONTENT_TAGS)}
      {renderTagGroup("Access", METADATA_TAGS)}
      <DomainFilter />
    </div>
  )
}
