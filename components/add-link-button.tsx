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

export function AddLinkButton({ onSuccess }: AddLinkButtonProps) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async () => {
    if (!url.trim()) return

    setIsLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch("/api/links/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to add link")
      }

      setSuccess(true)
      setUrl("")
      onSuccess?.()

      // Close dialog after a short delay
      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
      }, 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add link")
    } finally {
      setIsLoading(false)
    }
  }

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      setUrl("")
      setError(null)
      setSuccess(false)
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
              <span>Link added successfully!</span>
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
      </DialogContent>
    </Dialog>
  )
}
