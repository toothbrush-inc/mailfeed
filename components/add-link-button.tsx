"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Plus, Loader2, AlertTriangle, CheckCircle } from "lucide-react"

interface AddLinkButtonProps {
  onSuccess?: () => void
}

/** A link the user pasted that is already saved under a podcast episode's show notes. */
interface ShowNotesLink {
  id: string
  title: string | null
  url: string
  episode: string | null
}

export function AddLinkButton({ onSuccess }: AddLinkButtonProps) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  // Set when the pasted link has to be moved rather than added: the user is asked first
  const [toMove, setToMove] = useState<ShowNotesLink | null>(null)

  const finish = (message: string) => {
    setSuccess(message)
    setUrl("")
    setToMove(null)
    onSuccess?.()

    // Close dialog after a short delay
    setTimeout(() => {
      setOpen(false)
      setSuccess(null)
    }, 1500)
  }

  const handleSubmit = async () => {
    if (!url.trim()) return

    setIsLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch("/api/links/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      })

      const data = await response.json()

      if (response.status === 409 && data.code === "IN_SHOW_NOTES" && data.link?.id) {
        setToMove({ ...data.link, episode: data.episode ?? null })
        return
      }
      if (!response.ok) {
        throw new Error(data.error || "Failed to add link")
      }

      finish("Link added successfully!")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add link")
    } finally {
      setIsLoading(false)
    }
  }

  const handleMove = async () => {
    if (!toMove) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/links/${toMove.id}/move-to-feed`, { method: "POST" })
      const data = await response.json().catch(() => ({}))

      if (!response.ok) {
        throw new Error(data.error || "Couldn't move the link")
      }
      // Not moved after all (already in the feed), or moved with a caveat (hidden domain, fetch failed)
      if (!data.success) {
        setToMove(null)
        onSuccess?.()
        throw new Error(data.message || "Couldn't move the link")
      }

      finish(data.message || "Link moved to your feed!")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't move the link")
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      setUrl("")
      setError(null)
      setSuccess(null)
      setToMove(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add Link
        </Button>
      </DialogTrigger>
      <DialogContent>
        {toMove ? (
          <>
            <DialogHeader>
              <DialogTitle>Move this link to your feed?</DialogTitle>
              <DialogDescription>
                You already have it, saved as a reference from{" "}
                {toMove.episode ? <>the show notes of “{toMove.episode}”</> : "a podcast episode's show notes"}.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium break-words">{toMove.title || toMove.url}</p>
                {toMove.title && <p className="mt-0.5 break-all text-xs text-muted-foreground">{toMove.url}</p>}
              </div>
              <p className="text-sm text-muted-foreground">
                Moving it makes it a link of its own in your feed: its page is fetched and analyzed like a
                link you emailed yourself. It will no longer be listed under the episode.
              </p>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setToMove(null)
                    setError(null)
                  }}
                  disabled={isLoading}
                >
                  Cancel
                </Button>
                <Button onClick={handleMove} disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Moving...
                    </>
                  ) : (
                    "Move to feed"
                  )}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Add Link</DialogTitle>
              <DialogDescription>
                Paste a URL to add it to your feed. The content will be fetched and processed automatically.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              <div className="space-y-2">
                <Label htmlFor="add-link-url">URL</Label>
                <Input
                  id="add-link-url"
                  placeholder="https://example.com/article"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && url.trim() && !isLoading) {
                      handleSubmit()
                    }
                  }}
                  disabled={isLoading}
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-red-500">
                  <AlertTriangle className="h-4 w-4" />
                  <span>{error}</span>
                </div>
              )}

              {success && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <CheckCircle className="h-4 w-4" />
                  <span>{success}</span>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={handleSubmit}
                  disabled={isLoading || !url.trim()}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Adding...
                    </>
                  ) : (
                    "Add Link"
                  )}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
