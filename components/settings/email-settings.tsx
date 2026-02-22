"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Mail, AlertTriangle } from "lucide-react"
import { useSettings } from "@/hooks/use-settings"
import { useSync } from "@/hooks/use-sync"

export function EmailSettings() {
  const { settings, updateSettings } = useSettings()
  const { initialSync, isLoading: isSyncing } = useSync()
  const [isSaving, setIsSaving] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [query, setQuery] = useState("")
  const [initialized, setInitialized] = useState(false)

  if (settings && !initialized) {
    setQuery(settings.email.query)
    setInitialized(true)
  }

  if (!settings) return null

  const hasChanges = query !== settings.email.query

  const handleSave = () => {
    setShowConfirm(true)
  }

  const handleConfirmAndResync = async () => {
    setIsSaving(true)
    try {
      await updateSettings({ email: { query } })
      setShowConfirm(false)
      await initialSync()
    } catch {
      // sync errors are handled by useSync's error state
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
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
              Save Query
            </Button>
          )}
        </CardContent>
      </Card>

      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email query changed</DialogTitle>
            <DialogDescription>
              Changing the query resets your sync state. Previous emails are kept, but the next sync will start fresh with the new query.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-800 dark:bg-amber-950">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">Current:</span>{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{settings.email.query}</code>
              </p>
              <p className="text-muted-foreground">
                <span className="font-medium text-foreground">New:</span>{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">{query}</code>
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" size="sm" onClick={() => setShowConfirm(false)} disabled={isSaving || isSyncing}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleConfirmAndResync} disabled={isSaving || isSyncing}>
              {isSaving || isSyncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {isSyncing ? "Syncing..." : "Saving..."}
                </>
              ) : (
                "Save & Resync"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
