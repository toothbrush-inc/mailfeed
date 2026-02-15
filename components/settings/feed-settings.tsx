"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Loader2, LayoutList } from "lucide-react"
import { useSettings } from "@/hooks/use-settings"

const PAGE_SIZES = [10, 20, 50, 100]

const SORT_OPTIONS = [
  { value: "date_desc", label: "Newest first" },
  { value: "date_asc", label: "Oldest first" },
  { value: "reading_time_asc", label: "Shortest reading time" },
  { value: "reading_time_desc", label: "Longest reading time" },
]

export function FeedSettings() {
  const { settings, updateSettings } = useSettings()
  const [isSaving, setIsSaving] = useState(false)

  if (!settings) return null

  const handlePageSizeChange = async (value: string) => {
    setIsSaving(true)
    try {
      await updateSettings({ feed: { pageSize: parseInt(value) } })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSortChange = async (value: string) => {
    setIsSaving(true)
    try {
      await updateSettings({ feed: { defaultSort: value } })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <LayoutList className="h-5 w-5" />
          Feed Display
        </CardTitle>
        <CardDescription>
          Configure how your reading feed is displayed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="page-size">Links per Page</Label>
            <Select
              value={String(settings.feed.pageSize)}
              onValueChange={handlePageSizeChange}
              disabled={isSaving}
            >
              <SelectTrigger id="page-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="default-sort">Default Sort</Label>
            <Select
              value={settings.feed.defaultSort}
              onValueChange={handleSortChange}
              disabled={isSaving}
            >
              <SelectTrigger id="default-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isSaving && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Saving...
          </div>
        )}
      </CardContent>
    </Card>
  )
}
