"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { useStats } from "@/hooks/use-stats"

export function Sidebar() {
  const pathname = usePathname()
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
          <span>Links</span>
          {stats?.links !== undefined && (
            <span className="text-xs text-zinc-400">{stats.links}</span>
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
