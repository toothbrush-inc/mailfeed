"use client"

import { SidebarNav } from "./sidebar-nav"

export function Sidebar() {
  return (
    <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-64 shrink-0 self-start overflow-y-auto border-r bg-white dark:bg-zinc-950 md:block">
      <div className="p-4">
        <SidebarNav />
      </div>
    </aside>
  )
}
