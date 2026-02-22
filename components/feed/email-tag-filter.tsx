"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { FEATURE_FLAGS } from "@/lib/flags"

type EmailTag = "ARTICLE_LINK" | "REMINDER" | "MEETING_INFO" | "TODO" | "OTHER"

const TAGS: { value: EmailTag; label: string }[] = [
  { value: "ARTICLE_LINK", label: "Articles" },
  { value: "REMINDER", label: "Reminders" },
  { value: "MEETING_INFO", label: "Meetings" },
  { value: "TODO", label: "To-Dos" },
  { value: "OTHER", label: "Other" },
]

export function EmailTagFilter() {
  const searchParams = useSearchParams()
  const currentTag = searchParams.get("tag")

  if (!FEATURE_FLAGS.enableAnalysis) return null

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      <Link
        href="/emails"
        className={cn(
          "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-colors",
          !currentTag
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        )}
      >
        All
      </Link>
      {TAGS.map((tag) => (
        <Link
          key={tag.value}
          href={`/emails?tag=${tag.value}`}
          className={cn(
            "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium transition-colors",
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
}
