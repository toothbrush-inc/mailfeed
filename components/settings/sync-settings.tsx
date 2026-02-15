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
    maxPagesNormal: 1,
    maxPagesContinue: 5,
    maxPagesFull: 20,
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

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="max-pages-normal">Normal Sync Pages</Label>
            <Input
              id="max-pages-normal"
              type="number"
              min={1}
              max={50}
              value={values.maxPagesNormal}
              onChange={(e) => updateValue("maxPagesNormal", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-pages-continue">Continue Sync Pages</Label>
            <Input
              id="max-pages-continue"
              type="number"
              min={1}
              max={50}
              value={values.maxPagesContinue}
              onChange={(e) => updateValue("maxPagesContinue", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-pages-full">Full Sync Pages</Label>
            <Input
              id="max-pages-full"
              type="number"
              min={1}
              max={100}
              value={values.maxPagesFull}
              onChange={(e) => updateValue("maxPagesFull", e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Maximum Gmail pages to fetch per sync mode. Each page contains up to 50 emails.
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
