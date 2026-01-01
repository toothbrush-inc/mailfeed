"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Mail, ExternalLink, Star, Sparkles, Loader2 } from "lucide-react"

interface EmailLink {
  id: string
  url: string
  title: string | null
  domain: string | null
  aiSummary: string | null
  aiCategory: string | null
  aiTags: string[]
  fetchStatus: string
  isHighlighted: boolean
}

type EmailTag = "ARTICLE_LINK" | "REMINDER" | "MEETING_INFO" | "TODO" | "OTHER"

const TAG_LABELS: Record<EmailTag, string> = {
  ARTICLE_LINK: "Article",
  REMINDER: "Reminder",
  MEETING_INFO: "Meeting",
  TODO: "To-Do",
  OTHER: "Other",
}

const TAG_COLORS: Record<EmailTag, string> = {
  ARTICLE_LINK: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  REMINDER: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  MEETING_INFO: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  TODO: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  OTHER: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
}

interface EmailFeedItemProps {
  email: {
    id: string
    gmailId: string
    subject: string | null
    snippet: string | null
    receivedAt: string
    tags: EmailTag[]
    ingestedAt: string | null
    links: EmailLink[]
  }
  onIngestComplete?: () => void
}

export function EmailFeedItem({ email, onIngestComplete }: EmailFeedItemProps) {
  const [isIngesting, setIsIngesting] = useState(false)
  const [localTags, setLocalTags] = useState<EmailTag[]>(email.tags || [])
  const [localLinks, setLocalLinks] = useState<EmailLink[]>(email.links || [])

  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${email.gmailId}`
  const receivedDate = new Date(email.receivedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

  const handleIngest = async () => {
    setIsIngesting(true)
    try {
      const response = await fetch(`/api/emails/${email.id}/ingest`, {
        method: "POST",
      })
      const data = await response.json()

      if (response.ok && data.email) {
        if (data.email.tags) {
          setLocalTags(data.email.tags)
        }
        if (data.email.links) {
          setLocalLinks(data.email.links)
        }
        onIngestComplete?.()
      } else {
        console.error("Ingest failed:", data.error)
      }
    } catch (error) {
      console.error("Ingest error:", error)
    } finally {
      setIsIngesting(false)
    }
  }

  const hasBeenIngested = email.ingestedAt || localTags.length > 0

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span>{receivedDate}</span>
              <span>·</span>
              <span>{localLinks.length} link{localLinks.length !== 1 ? "s" : ""}</span>
            </div>
            <h3 className="text-lg font-semibold leading-tight">
              <a
                href={gmailUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {email.subject || "No subject"}
              </a>
            </h3>
            {email.snippet && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {email.snippet}
              </p>
            )}
            <div className="flex items-center gap-2 pt-1">
              {localTags.map((tag) => (
                <span
                  key={tag}
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TAG_COLORS[tag]}`}
                >
                  {TAG_LABELS[tag]}
                </span>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleIngest}
                disabled={isIngesting}
                className="h-6 px-2 text-xs"
              >
                {isIngesting ? (
                  <>
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    Analyzing...
                  </>
                ) : hasBeenIngested ? (
                  <>
                    <Sparkles className="mr-1 h-3 w-3" />
                    Re-analyze
                  </>
                ) : (
                  <>
                    <Sparkles className="mr-1 h-3 w-3" />
                    Analyze
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          {localLinks.map((link) => (
            <div
              key={link.id}
              className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
            >
              {link.isHighlighted && (
                <Star className="h-4 w-4 mt-0.5 text-amber-500 fill-amber-500 shrink-0" />
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline truncate"
                  >
                    {link.title || link.url}
                  </a>
                  <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                </div>
                {link.domain && (
                  <p className="text-xs text-muted-foreground">{link.domain}</p>
                )}
                {link.aiSummary && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {link.aiSummary}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {link.aiCategory && (
                    <Badge variant="secondary" className="text-xs">
                      {link.aiCategory}
                    </Badge>
                  )}
                  {link.aiTags?.map((tag) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
