"use client"

import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Mail, ExternalLink, Star } from "lucide-react"

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

interface EmailFeedItemProps {
  email: {
    id: string
    gmailId: string
    subject: string | null
    snippet: string | null
    receivedAt: string
    links: EmailLink[]
  }
}

export function EmailFeedItem({ email }: EmailFeedItemProps) {
  const gmailUrl = `https://mail.google.com/mail/u/0/#inbox/${email.gmailId}`
  const receivedDate = new Date(email.receivedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4" />
              <span>{receivedDate}</span>
              <span>·</span>
              <span>{email.links.length} link{email.links.length !== 1 ? "s" : ""}</span>
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
          </div>
        </div>
      </CardHeader>

      <CardContent>
        <div className="space-y-3">
          {email.links.map((link) => (
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
