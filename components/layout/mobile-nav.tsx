"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { signOut } from "next-auth/react"
import { Menu } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { SidebarNav } from "./sidebar-nav"

interface MobileNavProps {
  user: {
    name?: string | null
    email?: string | null
  }
}

export function MobileNav({ user }: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Close on route change, so a back/forward gesture can't leave the drawer up.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Close when the viewport reaches md, where the drawer is hidden but its
  // overlay would stay up and block the page.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)")
    const onChange = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false)
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>

      <SheetContent side="left" className="md:hidden">
        <SheetTitle>MailFeed</SheetTitle>
        <SheetDescription className="sr-only">
          Main navigation and account actions
        </SheetDescription>

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          <SidebarNav showIcons onNavigate={() => setOpen(false)} />
        </div>

        {/* Account block: on phones the header has no room for it. */}
        <div className="mt-auto border-t pt-4">
          <div className="flex items-center gap-3 px-1 pb-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-sm font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {(user.name || user.email || "?").charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-muted-foreground truncate text-xs">
                {user.email}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => signOut({ callbackUrl: "/" })}
          >
            Sign out
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
