"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useCategories } from "@/hooks/use-categories"
import { useStats } from "@/hooks/use-stats"

export function Sidebar() {
  const pathname = usePathname()
  const { categories, isLoading } = useCategories()
  const { stats } = useStats()

  return (
    <aside className="hidden w-64 shrink-0 border-r bg-white dark:bg-zinc-950 md:block">
      <nav className="flex flex-col gap-1 p-4">
        <Link
          href="/feed"
          className={cn(
            "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/feed"
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
          )}
        >
          <span>All Links</span>
          {stats?.links !== undefined && (
            <span className="text-xs text-zinc-400">{stats.links}</span>
          )}
        </Link>

        <Link
          href="/feed?highlighted=true"
          className={cn(
            "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/feed" && new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '').get("highlighted") === "true"
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
          )}
        >
          <span className="flex items-center gap-2">
            <span className="text-amber-500">★</span>
            Highlighted
          </span>
          {stats?.highlighted !== undefined && (
            <span className="text-xs text-zinc-400">{stats.highlighted}</span>
          )}
        </Link>

        <Link
          href="/emails"
          className={cn(
            "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/emails"
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
          )}
        >
          <span>Emails</span>
          {stats?.emails !== undefined && (
            <span className="text-xs text-zinc-400">{stats.emails}</span>
          )}
        </Link>

        <Link
          href="/domains"
          className={cn(
            "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/domains"
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
          )}
        >
          <span>Domains</span>
          {stats?.domains !== undefined && (
            <span className="text-xs text-zinc-400">{stats.domains}</span>
          )}
        </Link>

        <Link
          href="/content"
          className={cn(
            "flex items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors",
            pathname === "/content"
              ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
              : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
          )}
        >
          <span>Content Feed</span>
          {stats?.withContent !== undefined && (
            <span className="text-xs text-zinc-400">{stats.withContent}</span>
          )}
        </Link>

        <div className="mt-4 mb-2 px-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Categories
          </h3>
        </div>

        {isLoading ? (
          <div className="space-y-2 px-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-8 animate-pulse rounded-md bg-zinc-100 dark:bg-zinc-800"
              />
            ))}
          </div>
        ) : (
          categories.map((category) => (
            <Link
              key={category.id}
              href={`/feed?category=${encodeURIComponent(category.name)}`}
              className={cn(
                "flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors",
                "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
              )}
            >
              <span>{category.name}</span>
              <span className="text-xs text-zinc-400">
                {category._count?.links || 0}
              </span>
            </Link>
          ))
        )}

        <div className="mt-4 border-t pt-4">
          <Link
            href="/stats"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/stats"
                ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
            )}
          >
            Stats
          </Link>

          <Link
            href="/reports"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/reports"
                ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
            )}
          >
            Reports
          </Link>

          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              pathname === "/settings"
                ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
            )}
          >
            Settings
          </Link>
        </div>
      </nav>
    </aside>
  )
}
