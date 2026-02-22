"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, RefreshCw } from "lucide-react"
import { useSettings } from "@/hooks/use-settings"

export function SyncSettings() {
  const { settings, updateSettings } = useSettings()
  const [isSaving, setIsSaving] = useState(false)
  const [values, setValues] = useState({
    emailConcurrency: 10,
    linkConcurrency: 5,
    maxPagesLoadMore: 5,
    maxPagesInitial: 5,
  })
  const [initialized, setInitialized] = useState(false)

  if (settings && !initialized) {
    setValues(settings.sync)
    setInitialized(true)
  }

  if (!settings) return null

  const hasChanges = JSON.stringify(values) !== JSON.stringify(settings.sync)

  const updateValue = (key: keyof typeof values, raw: string) => {
    const num = parseInt(raw) || 0
    setValues((prev) => ({ ...prev, [key]: num }))
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateSettings({ sync: values })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <RefreshCw className="h-5 w-5" />
          Sync Settings
        </CardTitle>
        <CardDescription>
          Configure concurrency and pagination limits for email sync.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="email-concurrency">Email Fetch Concurrency</Label>
            <Input
              id="email-concurrency"
              type="number"
              min={1}
              max={50}
              value={values.emailConcurrency}
              onChange={(e) => updateValue("emailConcurrency", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Emails fetched in parallel from Gmail (1-50)
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="link-concurrency">Link Fetch Concurrency</Label>
            <Input
              id="link-concurrency"
              type="number"
              min={1}
              max={20}
              value={values.linkConcurrency}
              onChange={(e) => updateValue("linkConcurrency", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Links fetched in parallel during sync (1-20)
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="max-pages-initial">Initial Sync Pages</Label>
            <Input
              id="max-pages-initial"
              type="number"
              min={1}
              max={100}
              value={values.maxPagesInitial}
              onChange={(e) => updateValue("maxPagesInitial", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Pages fetched on first sync or full resync
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-pages-load-more">Load More Pages</Label>
            <Input
              id="max-pages-load-more"
              type="number"
              min={1}
              max={50}
              value={values.maxPagesLoadMore}
              onChange={(e) => updateValue("maxPagesLoadMore", e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Pages fetched when loading older history
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Each page contains up to 50 emails. &ldquo;Check New&rdquo; always fetches 1 page.
        </p>

        {hasChanges && (
          <Button onClick={handleSave} disabled={isSaving} size="sm">
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Sync Settings"
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
