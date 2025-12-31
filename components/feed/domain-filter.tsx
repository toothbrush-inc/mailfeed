"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { useDomains } from "@/hooks/use-domains"
import { Loader2 } from "lucide-react"

export function DomainFilter() {
  const searchParams = useSearchParams()
  const currentDomain = searchParams.get("domain")
  const { domains, isLoading } = useDomains()

  // Build URL preserving other params but updating domain
  const buildUrl = (domain: string | null) => {
    const params = new URLSearchParams(searchParams.toString())
    if (domain) {
      params.set("domain", domain)
    } else {
      params.delete("domain")
    }
    // Reset to page 1 when changing filter
    params.delete("page")
    const queryString = params.toString()
    return `/feed${queryString ? `?${queryString}` : ""}`
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading domains...
      </div>
    )
  }

  if (domains.length === 0) {
    return null
  }

  // Show top 15 domains to avoid overwhelming the UI
  const topDomains = domains.slice(0, 15)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground font-medium min-w-[70px]">
        Domain:
      </span>
      <Link
        href={buildUrl(null)}
        className={cn(
          "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
          !currentDomain
            ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        )}
      >
        All
      </Link>
      {topDomains.map(({ domain, count }) => (
        <Link
          key={domain}
          href={buildUrl(domain)}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
            currentDomain === domain
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          )}
        >
          {domain}
          <span className="text-[10px] opacity-60">({count})</span>
        </Link>
      ))}
    </div>
  )
}
