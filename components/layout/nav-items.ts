import {
  BarChart3,
  Clapperboard,
  Flag,
  Globe,
  Link2,
  Mail,
  Newspaper,
  Settings,
  type LucideIcon,
} from "lucide-react"

import type { Stats } from "@/hooks/use-stats"

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
  /** Key in the stats payload whose count is shown beside the label. */
  countKey?: keyof Stats
}

/**
 * Single source of nav items for the desktop sidebar and the mobile drawer,
 * so the two can never drift apart.
 */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/feed", label: "Links", icon: Link2, countKey: "links" },
  { href: "/media", label: "Media", icon: Clapperboard },
  { href: "/emails", label: "Emails", icon: Mail, countKey: "emails" },
  { href: "/domains", label: "Domains", icon: Globe, countKey: "domains" },
]

export const SECONDARY_NAV: NavItem[] = [
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/digest", label: "Digest", icon: Newspaper },
  { href: "/reports", label: "Reports", icon: Flag },
  { href: "/settings", label: "Settings", icon: Settings },
]
