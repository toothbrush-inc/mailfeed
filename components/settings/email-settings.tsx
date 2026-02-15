"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Loader2, Mail } from "lucide-react"
import { useSettings } from "@/hooks/use-settings"

export function EmailSettings() {
  const { settings, updateSettings } = useSettings()
  const [isSaving, setIsSaving] = useState(false)
  const [query, setQuery] = useState("")
  const [initialized, setInitialized] = useState(false)

  if (settings && !initialized) {
    setQuery(settings.email.query)
    setInitialized(true)
  }

  if (!settings) return null

  const hasChanges = query !== settings.email.query

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateSettings({ email: { query } })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Query
        </CardTitle>
        <CardDescription>
          Customize which emails are fetched during sync. Uses Gmail search syntax.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email-query">Gmail Search Query</Label>
          <Input
            id="email-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="from:me to:me"
          />
          <div className="text-xs text-muted-foreground space-y-1">
            <p>Examples:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li><code className="rounded bg-muted px-1 py-0.5">from:me to:me</code> — self-sent emails (default)</li>
              <li><code className="rounded bg-muted px-1 py-0.5">is:starred</code> — starred emails</li>
              <li><code className="rounded bg-muted px-1 py-0.5">label:reading-list</code> — emails with a specific label</li>
              <li><code className="rounded bg-muted px-1 py-0.5">from:newsletter@example.com</code> — from a specific sender</li>
            </ul>
            <a
              href="https://support.google.com/mail/answer/7190?hl=en"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block mt-1 text-primary hover:underline"
            >
              Gmail search operators reference
            </a>
          </div>
        </div>

        {hasChanges && (
          <Button onClick={handleSave} disabled={isSaving} size="sm">
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Query"
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
