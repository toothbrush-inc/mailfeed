"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ExternalLink, Clock, ChevronDown, ChevronUp, Star, BookOpen } from "lucide-react"

interface ContentCardProps {
  link: {
    id: string
    url: string
    finalUrl: string | null
    domain: string | null
    finalDomain: string | null
    title: string | null
    imageUrl: string | null
    contentText: string | null
    contentHtml: string | null
    rawHtml: string | null
    aiSummary: string | null
    readingTimeMin: number | null
    wordCount: number | null
    isHighlighted: boolean
    isRead: boolean
    createdAt: string
    email: {
      receivedAt: string
    } | null
  }
}

// Extract readable text from HTML, preserving paragraph structure
function extractTextFromHtml(html: string): string {
  // Remove script and style tags and their contents
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
  // Convert block elements to paragraph breaks
  text = text.replace(/<\/?(p|div|br|h[1-6]|li|blockquote|article|section)[^>]*>/gi, "\n\n")
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

// Format text into proper paragraphs
function formatIntoParagraphs(text: string): string[] {
  // Split on double newlines to get paragraphs
  const paragraphs = text.split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
  return paragraphs
}

// Get the first N words, respecting paragraph boundaries
function getPreviewParagraphs(paragraphs: string[], maxWords: number = 150): { preview: string[]; hasMore: boolean } {
  const result: string[] = []
  let wordCount = 0

  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter(Boolean)
    if (wordCount + words.length <= maxWords) {
      result.push(para)
      wordCount += words.length
    } else {
      // Add partial paragraph if we haven't added anything yet
      if (result.length === 0) {
        const remainingWords = maxWords - wordCount
        result.push(words.slice(0, remainingWords).join(" ") + "...")
      }
      return { preview: result, hasMore: true }
    }
  }

  return { preview: result, hasMore: false }
}

// Format date
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

export function ContentCard({ link }: ContentCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Check if we have structured HTML content
  const hasHtmlContent = !!link.contentHtml

  // Get the readable content for text fallback
  const rawText = link.contentText || (link.rawHtml ? extractTextFromHtml(link.rawHtml) : "")
  const allParagraphs = formatIntoParagraphs(rawText)
  const { preview: previewParagraphs, hasMore: textHasMore } = getPreviewParagraphs(allParagraphs, 150)

  // For HTML content, estimate if there's more based on word count
  const hasMore = hasHtmlContent
    ? (link.wordCount ?? 0) > 150
    : textHasMore

  const displayDomain = link.finalDomain || link.domain
  const displayUrl = link.finalUrl || link.url
  const displayDate = link.email?.receivedAt || link.createdAt

  // Check if we have any content to show
  const hasContent = hasHtmlContent || allParagraphs.length > 0
  if (!hasContent) {
    return null // Don't render cards without content
  }

  const paragraphsToShow = isExpanded ? allParagraphs : previewParagraphs

  return (
    <Card
      className={cn(
        "transition-all overflow-hidden",
        link.isHighlighted && "ring-2 ring-amber-400 dark:ring-amber-500",
        link.isRead && "opacity-60"
      )}
    >
      {/* Hero image if available */}
      {link.imageUrl && isExpanded && (
        <div className="w-full h-48 overflow-hidden">
          <img
            src={link.imageUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        </div>
      )}

      <CardHeader className={cn("space-y-3", isExpanded ? "pb-4 pt-6" : "pb-3")}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            {link.isHighlighted && (
              <div className="flex items-center gap-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
                <Star className="h-4 w-4 fill-current" />
                <span>Highlighted</span>
              </div>
            )}
            <h2 className={cn(
              "font-bold leading-tight tracking-tight",
              isExpanded ? "text-2xl md:text-3xl" : "text-xl"
            )}>
              <a
                href={displayUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline decoration-2 underline-offset-2"
              >
                {link.title || displayUrl}
              </a>
            </h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-medium">{displayDomain}</span>
              <span className="text-muted-foreground/50">·</span>
              <span>{formatDate(displayDate)}</span>
              {link.readingTimeMin && (
                <>
                  <span className="text-muted-foreground/50">·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    {link.readingTimeMin} min read
                  </span>
                </>
              )}
            </div>
          </div>
          {link.imageUrl && !isExpanded && (
            <img
              src={link.imageUrl}
              alt=""
              className="h-20 w-20 rounded-lg object-cover shrink-0 shadow-sm"
            />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* AI Summary */}
        {link.aiSummary && (
          <div className="rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 p-4 border border-blue-100 dark:border-blue-900/50">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-700 dark:text-blue-300 mb-2">
              <BookOpen className="h-4 w-4" />
              Quick Summary
            </div>
            <p className="text-sm leading-relaxed text-blue-900 dark:text-blue-100">
              {link.aiSummary}
            </p>
          </div>
        )}

        {/* Article content - Reader mode styling */}
        <article className={cn(
          "reader-content",
          isExpanded && "pb-4"
        )}>
          {/* Render HTML content when expanded and available */}
          {hasHtmlContent && isExpanded ? (
            <div
              className={cn(
                "prose prose-zinc dark:prose-invert max-w-none",
                // Reader-friendly typography
                "prose-p:text-[17px] prose-p:leading-[1.8] prose-p:tracking-[-0.003em]",
                "prose-p:text-zinc-800 dark:prose-p:text-zinc-200",
                "prose-p:mb-4",
                // Headings
                "prose-headings:font-bold prose-headings:tracking-tight",
                "prose-h2:text-xl prose-h2:mt-8 prose-h2:mb-4",
                "prose-h3:text-lg prose-h3:mt-6 prose-h3:mb-3",
                // Lists
                "prose-ul:my-4 prose-ol:my-4",
                "prose-li:text-[17px] prose-li:leading-[1.8]",
                // Blockquotes
                "prose-blockquote:border-l-4 prose-blockquote:border-zinc-300 dark:prose-blockquote:border-zinc-600",
                "prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-zinc-600 dark:prose-blockquote:text-zinc-400",
                // Links
                "prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline",
                // Images
                "prose-img:rounded-lg prose-img:my-4",
                // Code
                "prose-code:bg-zinc-100 dark:prose-code:bg-zinc-800 prose-code:px-1 prose-code:rounded",
              )}
              dangerouslySetInnerHTML={{ __html: link.contentHtml! }}
            />
          ) : (
            /* Text-based rendering for preview or fallback */
            <div className={cn(
              "space-y-4",
              // Reader-friendly typography
              "text-[17px] leading-[1.8] tracking-[-0.003em]",
              "text-zinc-800 dark:text-zinc-200",
              // Serif font for better readability (falls back to system serif)
              "font-serif",
            )}>
              {paragraphsToShow.map((paragraph, index) => (
                <p key={index} className="text-justify hyphens-auto">
                  {paragraph}
                </p>
              ))}
            </div>
          )}

          {/* Fade effect when collapsed */}
          {!isExpanded && hasMore && (
            <div className="relative h-16 -mt-16 bg-gradient-to-t from-white dark:from-zinc-950 to-transparent pointer-events-none" />
          )}
        </article>

        {/* Action buttons */}
        <div className={cn(
          "flex items-center gap-2 pt-2",
          hasMore ? "justify-between" : "justify-end"
        )}>
          {hasMore && (
            <Button
              variant={isExpanded ? "outline" : "default"}
              size="sm"
              onClick={() => setIsExpanded(!isExpanded)}
              className="gap-2"
            >
              {isExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Collapse
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Continue reading
                  {link.wordCount && (
                    <span className="text-xs opacity-70">({link.wordCount} words)</span>
                  )}
                </>
              )}
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <a href={displayUrl} target="_blank" rel="noopener noreferrer">
              View original
              <ExternalLink className="ml-1.5 h-4 w-4" />
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
