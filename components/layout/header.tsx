"use client"

import { signOut } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { SyncButton } from "@/components/sync/sync-button"
import { MobileNav } from "@/components/layout/mobile-nav"

interface HeaderProps {
  user: {
    name?: string | null
    email?: string | null
    image?: string | null
  }
}

export function Header({ user }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 h-16 w-full border-b bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:bg-zinc-950/95 dark:supports-[backdrop-filter]:bg-zinc-950/60">
      <div className="flex h-full items-center justify-between gap-2 px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-1 md:gap-4">
          <MobileNav user={user} />
          <h1 className="truncate text-lg font-bold md:text-xl">MailFeed</h1>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          <SyncButton />

          {/* Avatar and sign-out live in the drawer on phones. */}
          <div className="hidden items-center gap-3 md:flex">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {(user.name || user.email || "?").charAt(0).toUpperCase()}
            </div>
            <div className="hidden lg:block">
              <p className="text-sm font-medium">{user.name}</p>
              <p className="text-muted-foreground text-xs">{user.email}</p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ callbackUrl: "/" })}
            >
              Sign out
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
