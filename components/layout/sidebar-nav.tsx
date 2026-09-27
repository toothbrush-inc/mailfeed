"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { cn } from "@/lib/utils"
import { useStats } from "@/hooks/use-stats"
import { PRIMARY_NAV, SECONDARY_NAV, type NavItem } from "./nav-items"

interface SidebarNavProps {
  /** Called after a link is activated, so the mobile drawer can close itself. */
  onNavigate?: () => void
  /** Icons are shown in the drawer, where the wider tap targets have room. */
  showIcons?: boolean
}

export function SidebarNav({ onNavigate, showIcons = false }: SidebarNavProps) {
  const pathname = usePathname()
  const { stats } = useStats()

  const renderItem = (item: NavItem) => {
    const Icon = item.icon
    const isActive = pathname === item.href
    const count = item.countKey ? stats?.[item.countKey] : undefined

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          // min-h-11 keeps every row at a comfortable touch target on phones.
          "flex min-h-11 items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
          isActive
            ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-50"
            : "text-zinc-600 hover:bg-zinc-50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
        )}
      >
        <span className="flex items-center gap-2">
          {showIcons && <Icon className="h-4 w-4 shrink-0" />}
          {item.label}
        </span>
        {count !== undefined && (
          <span className="text-xs text-zinc-400">{count}</span>
        )}
      </Link>
    )
  }

  return (
    <nav className="flex flex-col gap-1">
      {PRIMARY_NAV.map(renderItem)}
      <div className="mt-4 flex flex-col gap-1 border-t pt-4">
        {SECONDARY_NAV.map(renderItem)}
      </div>
    </nav>
  )
}
