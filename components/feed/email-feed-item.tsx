"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Mail, ExternalLink, Star, Sparkles, Loader2, ChevronDown, ChevronUp } from "lucide-react"
import { FEATURE_FLAGS } from "@/lib/flags"

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
    rawContent: string | null
    receivedAt: string
    tags: EmailTag[]
    ingestedAt: string | null
    links: EmailLink[]
  }
  onIngestComplete?: () => void
}

// Extract readable text from HTML email content
function extractTextFromHtml(html: string): string {
  // Remove script and style tags and their contents
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
  // Convert block elements to paragraph breaks
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|blockquote|article|section|tr)[^>]*>/gi, "\n\n")
  // Remove remaining HTML tags
  text = text.replace(/<[^>]+>/g, " ")
  // Decode HTML entities
  text = text.replace(/&nbsp;/g, " ")
  text = text.replace(/&amp;/g, "&")
  text = text.replace(/&lt;/g, "<")
  text = text.replace(/&gt;/g, ">")
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&mdash;/g, "—")
  text = text.replace(/&ndash;/g, "–")
  text = text.replace(/&hellip;/g, "...")
  text = text.replace(/&#\d+;/g, "")
  // Clean up whitespace while preserving paragraph breaks
  text = text.replace(/[ \t]+/g, " ")
  text = text.replace(/\n\s*\n/g, "\n\n")
  text = text.replace(/\n{3,}/g, "\n\n")
  return text.trim()
}

// Format text into proper paragraphs, removing duplicates
function formatIntoParagraphs(text: string): string[] {
  const paragraphs = text.split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)

  // Remove duplicate paragraphs (common in email HTML with preview/body sections)
  const seen = new Set<string>()
  const unique: string[] = []
  for (const para of paragraphs) {
    // Normalize for comparison (lowercase, collapse whitespace)
    const normalized = para.toLowerCase().replace(/\s+/g, ' ')
    if (!seen.has(normalized)) {
      seen.add(normalized)
      unique.push(para)
    }
  }
  return unique
}

// Get the first N words for preview
function getPreviewParagraphs(paragraphs: string[], maxWords: number = 100): { preview: string[]; hasMore: boolean } {
  const result: string[] = []
  let wordCount = 0

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean)
    if (wordCount + words.length <= maxWords) {
      result.push(para)
      wordCount += words.length
    } else {
      if (result.length === 0) {
        const remainingWords = maxWords - wordCount
        result.push(words.slice(0, remainingWords).join(" ") + "...")
      }
      return { preview: result, hasMore: true }
    }
  }

  return { preview: result, hasMore: false }
}

export function EmailFeedItem({ email, onIngestComplete }: EmailFeedItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isIngesting, setIsIngesting] = useState(false)
  const [localTags, setLocalTags] = useState<EmailTag[]>(email.tags || [])
  const [localLinks, setLocalLinks] = useState<EmailLink[]>(email.links || [])

  // Parse email body content
  const rawText = email.rawContent ? extractTextFromHtml(email.rawContent) : ""
  const allParagraphs = formatIntoParagraphs(rawText)
  const { preview: previewParagraphs, hasMore } = getPreviewParagraphs(allParagraphs, 100)
  const hasEmailBody = allParagraphs.length > 0
  const paragraphsToShow = isExpanded ? allParagraphs : previewParagraphs

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
            {FEATURE_FLAGS.enableAnalysis && (
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
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Email Body */}
        {hasEmailBody && (
          <div className="space-y-3">
            <article className={cn(
              "relative",
              isExpanded && "pb-2"
            )}>
              <div className={cn(
                "space-y-3 text-sm text-muted-foreground leading-relaxed",
              )}>
                {paragraphsToShow.map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>

              {/* Fade effect when collapsed */}
              {!isExpanded && hasMore && (
                <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-card to-transparent pointer-events-none" />
              )}
            </article>

            {/* Expand/Collapse button */}
            {hasMore && (
              <Button
                variant={isExpanded ? "outline" : "secondary"}
                size="sm"
                onClick={() => setIsExpanded(!isExpanded)}
                className="gap-1.5"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-4 w-4" />
                    Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-4 w-4" />
                    Read more
                  </>
                )}
              </Button>
            )}
          </div>
        )}

        {/* Links Section */}
        {localLinks.length > 0 && (
          <div className="space-y-3">
            {hasEmailBody && (
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Links ({localLinks.length})
              </div>
            )}
            {localLinks.map((link) => (
              <div
                key={link.id}
                className="flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
              >
                {FEATURE_FLAGS.enableAnalysis && link.isHighlighted && (
                  <Star className="h-4 w-4 mt-0.5 text-amber-500 fill-amber-500 shrink-0" />
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/feed?search=${encodeURIComponent(link.url)}`}
                      className="font-medium hover:underline truncate"
                    >
                      {link.title || link.url}
                    </Link>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground shrink-0"
                      title="Open external link"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  {link.domain && (
                    <p className="text-xs text-muted-foreground">{link.domain}</p>
                  )}
                  {FEATURE_FLAGS.enableAnalysis && link.aiSummary && (
                    <p className="text-sm text-muted-foreground line-clamp-2">
                      {link.aiSummary}
                    </p>
                  )}
                  {FEATURE_FLAGS.enableAnalysis && (link.aiCategory || link.aiTags?.length > 0) && (
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
                  )}
                </div>
              </div>
          ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
