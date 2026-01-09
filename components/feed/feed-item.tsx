"use client"

import { useState } from "react"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Mail, ExternalLink, Clock, AlertTriangle, Sparkles, Loader2, RefreshCw, Code, Calendar, Eye, EyeOff, Link2, Archive, Twitter, BookOpen, ChevronDown, ChevronUp } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { SocialEmbed, isEmbeddable } from "./social-embed"
import { NestedLinkItem } from "./nested-link-item"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Highlighter from "react-highlight-words"

interface FeedItemProps {
  link: {
    id: string
    url: string
    domain: string | null
    finalUrl: string | null
    finalDomain: string | null
    wasRedirected: boolean
    title: string | null
    imageUrl: string | null
    aiSummary: string | null
    aiKeyPoints: string[]
    aiCategory: string | null
    aiTags: string[]
    linkTags: string[]
    contentTags: string[]
    metadataTags: string[]
    readingTimeMin: number | null
    worthinessScore: number | null
    uniquenessScore: number | null
    isHighlighted: boolean
    highlightReason: string | null
    isPaywalled: boolean
    paywallType: string | null
    fetchStatus: string
    contentSource: string | null
    archivedUrl: string | null
    contentText: string | null
    contentHtml: string | null
    rawHtml: string | null
    wordCount: number | null
    isRead: boolean
    readAt: string | null
    createdAt: string
    email: {
      gmailId: string
      subject: string | null
      receivedAt: string
      rawContent: string | null
    } | null
    childLinks: Array<{
      id: string
      url: string
      title: string | null
      domain: string | null
      finalUrl: string | null
      finalDomain: string | null
      aiSummary: string | null
      aiKeyPoints: string[]
      aiCategory: string | null
      aiTags: string[]
      linkTags: string[]
      contentTags: string[]
      metadataTags: string[]
      fetchStatus: string
      isHighlighted: boolean
      highlightReason: string | null
      isRead: boolean
      readingTimeMin: number | null
      imageUrl: string | null
      isPaywalled: boolean
      paywallType: string | null
      contentSource: string | null
      archivedUrl: string | null
      wordCount: number | null
    }>
  }
  searchTerm?: string
  onAnalyzeComplete?: () => void
  onHideDomain?: (domain: string) => Promise<void>
}

// Format date as "Jan 15" or "Jan 15, 2024" if different year
function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const isCurrentYear = date.getFullYear() === now.getFullYear()

  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    ...(isCurrentYear ? {} : { year: "numeric" }),
  }

  return date.toLocaleDateString("en-US", options)
}

export function FeedItem({ link, searchTerm, onAnalyzeComplete, onHideDomain }: FeedItemProps) {
  // Search words for highlighting
  const searchWords = searchTerm ? [searchTerm] : []
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isRefetching, setIsRefetching] = useState(false)
  const [isFetchingArchive, setIsFetchingArchive] = useState(false)
  const [archiveError, setArchiveError] = useState<string | null>(null)
  const [rawContent, setRawContent] = useState<string | null>(null)
  const [isLoadingRaw, setIsLoadingRaw] = useState(false)
  const [isTogglingRead, setIsTogglingRead] = useState(false)
  const [isRead, setIsRead] = useState(link.isRead)
  const [isHidingDomain, setIsHidingDomain] = useState(false)
  const [isResolvingXArticle, setIsResolvingXArticle] = useState(false)
  const [xArticleUsername, setXArticleUsername] = useState("")
  const [xArticleError, setXArticleError] = useState<string | null>(null)
  const [xArticleDialogOpen, setXArticleDialogOpen] = useState(false)
  const [isContentExpanded, setIsContentExpanded] = useState(false)

  // Check if we have article content to show
  const hasArticleContent = !!(link.contentHtml || link.contentText)
  // Check if we have email content as fallback
  const hasEmailContent = !!(link.email?.rawContent)
  // Show expand button if we have any content
  const hasExpandableContent = hasArticleContent || hasEmailContent

  // Check if this is an X article URL that needs resolution
  const isXArticleUrl = /^https?:\/\/(x\.com|twitter\.com)\/i\/article\/\d+/i.test(link.url)

  const isProcessing = ["PENDING", "FETCHING", "ANALYZING"].includes(link.fetchStatus)
  const hasFailed = link.fetchStatus === "FAILED"
  const hasPaywall = link.fetchStatus === "PAYWALL_DETECTED"
  const hasBeenAnalyzed = link.linkTags?.length > 0 || link.contentTags?.length > 0 || link.aiCategory
  const needsAnalysis = link.fetchStatus === "FETCHED" && !hasBeenAnalyzed
  const gmailUrl = link.email?.gmailId
    ? `https://mail.google.com/mail/u/0/#inbox/${link.email.gmailId}`
    : null
  const emailDate = link.email?.receivedAt ? formatDate(link.email.receivedAt) : null

  const handleAnalyze = async () => {
    setIsAnalyzing(true)
    try {
      const response = await fetch(`/api/links/${link.id}/analyze`, {
        method: "POST",
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Analysis failed")
      }
      onAnalyzeComplete?.()
    } catch (error) {
      console.error("Failed to analyze link:", error)
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleRefetch = async () => {
    setIsRefetching(true)
    try {
      const response = await fetch(`/api/links/${link.id}/refetch`, {
        method: "POST",
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Refetch failed")
      }
      onAnalyzeComplete?.()
    } catch (error) {
      console.error("Failed to refetch link:", error)
    } finally {
      setIsRefetching(false)
    }
  }

  const handleLoadRawContent = async () => {
    if (rawContent !== null) return // Already loaded
    setIsLoadingRaw(true)
    try {
      const response = await fetch(`/api/links/${link.id}/raw`)
      if (!response.ok) {
        throw new Error("Failed to load raw content")
      }
      const data = await response.json()
      // Show rawHtml if available, otherwise contentText
      const content = data.rawHtml || data.contentText || "No content stored"
      const label = data.rawHtml ? "[rawHtml]" : "[contentText]"
      setRawContent(`${label}\n\n${content}`)
    } catch (error) {
      console.error("Failed to load raw content:", error)
      setRawContent("Error loading content")
    } finally {
      setIsLoadingRaw(false)
    }
  }

  const handleToggleRead = async () => {
    setIsTogglingRead(true)
    try {
      const response = await fetch(`/api/links/${link.id}/read`, {
        method: isRead ? "DELETE" : "POST",
      })
      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || "Failed to update read status")
      }
      setIsRead(!isRead)
      onAnalyzeComplete?.()
    } catch (error) {
      console.error("Failed to toggle read status:", error)
    } finally {
      setIsTogglingRead(false)
    }
  }

  const handleFetchFromArchive = async () => {
    setIsFetchingArchive(true)
    setArchiveError(null)
    try {
      const response = await fetch(`/api/links/${link.id}/wayback`, {
        method: "POST",
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.error || "Failed to fetch from archive")
      }
      if (!data.success) {
        throw new Error(data.error || "No archived version found")
      }
      onAnalyzeComplete?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch from archive"
      console.warn("Failed to fetch from archive:", message)
      setArchiveError(message)
    } finally {
      setIsFetchingArchive(false)
    }
  }

  const handleHideDomain = async () => {
    const domainToHide = link.finalDomain || link.domain
    if (!domainToHide || !onHideDomain) return

    setIsHidingDomain(true)
    try {
      await onHideDomain(domainToHide)
    } finally {
      setIsHidingDomain(false)
    }
  }

  const handleResolveXArticle = async (autoResolve: boolean = false) => {
    setIsResolvingXArticle(true)
    setXArticleError(null)

    try {
      const body: Record<string, unknown> = { refetch: true }
      if (!autoResolve && xArticleUsername.trim()) {
        body.username = xArticleUsername.trim()
      }

      const response = await fetch(`/api/links/${link.id}/resolve-x-article`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        if (data.needsUsername) {
          setXArticleError(data.error || "Please enter the X username for this article")
          return
        }
        throw new Error(data.error || "Failed to resolve URL")
      }

      setXArticleDialogOpen(false)
      setXArticleUsername("")
      onAnalyzeComplete?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resolve X article URL"
      setXArticleError(message)
    } finally {
      setIsResolvingXArticle(false)
    }
  }

  const displayDomain = link.finalDomain || link.domain

  return (
    <Card
      className={cn(
        "transition-all hover:shadow-md",
        link.isHighlighted && "ring-2 ring-amber-400 dark:ring-amber-500",
        isRead && "opacity-60"
      )}
    >
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            {link.isHighlighted && (
              <div className="flex items-center gap-1 text-sm font-medium text-amber-600 dark:text-amber-400">
                <span>★</span>
                <span>Highlighted</span>
              </div>
            )}
            <h3 className="text-lg font-semibold leading-tight">
              <a
                href={link.finalUrl || link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {searchTerm ? (
                  <Highlighter
                    searchWords={searchWords}
                    autoEscape={true}
                    textToHighlight={link.title || link.finalUrl || link.url}
                    highlightClassName="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5"
                  />
                ) : (
                  link.title || link.finalUrl || link.url
                )}
              </a>
            </h3>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>
                {searchTerm && displayDomain ? (
                  <Highlighter
                    searchWords={searchWords}
                    autoEscape={true}
                    textToHighlight={displayDomain}
                    highlightClassName="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5"
                  />
                ) : (
                  displayDomain
                )}
              </span>
              {displayDomain && onHideDomain && (
                <button
                  onClick={handleHideDomain}
                  disabled={isHidingDomain}
                  className="text-xs text-muted-foreground/70 hover:text-foreground transition-colors disabled:opacity-50"
                  title={`Hide all links from ${displayDomain}`}
                >
                  {isHidingDomain ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <EyeOff className="h-3 w-3" />
                  )}
                </button>
              )}
              {link.wasRedirected && link.domain && (
                <span className="text-xs text-muted-foreground/70">
                  (from {link.domain})
                </span>
              )}
              {link.readingTimeMin && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {link.readingTimeMin} min read
                  </span>
                </>
              )}
              {emailDate && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Calendar className="h-3 w-3" />
                    {emailDate}
                  </span>
                </>
              )}
            </div>
          </div>
          {link.imageUrl && (
            <img
              src={link.imageUrl}
              alt=""
              className="h-24 w-24 rounded-md object-cover"
            />
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Social media embed (Twitter, Instagram, etc.) */}
        {isEmbeddable(link.finalDomain || link.domain, link.rawHtml, link.finalUrl || link.url) && link.rawHtml && (
          <SocialEmbed
            html={link.rawHtml}
            url={link.finalUrl || link.url}
            domain={link.finalDomain || link.domain}
          />
        )}

        {/* Nested/child links extracted from this post */}
        {link.childLinks?.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Link2 className="h-4 w-4" />
              <span>Links in this post ({link.childLinks.length})</span>
            </div>
            <div className="space-y-3">
              {link.childLinks.map((childLink) => (
                <NestedLinkItem
                  key={childLink.id}
                  link={childLink}
                  onUpdate={onAnalyzeComplete}
                />
              ))}
            </div>
          </div>
        )}

        {link.isPaywalled && (
          <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            <span>
              {link.paywallType === "hard" && "Paywalled content"}
              {link.paywallType === "soft" && "Limited free access"}
              {link.paywallType === "registration" && "Registration required"}
            </span>
          </div>
        )}

        {/* X Article URL resolution prompt */}
        {isXArticleUrl && !link.finalUrl && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
            <div className="flex items-start gap-3">
              <Twitter className="h-5 w-5 text-blue-500 mt-0.5 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  X Article URL needs resolution
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  This URL format ({link.url.slice(0, 40)}...) requires the author&apos;s username to fetch content.
                </p>
                <Dialog open={xArticleDialogOpen} onOpenChange={setXArticleDialogOpen}>
                  <DialogTrigger asChild>
                    <Button size="sm" variant="outline" className="mt-1">
                      <Twitter className="mr-2 h-4 w-4" />
                      Fix URL
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Resolve X Article URL</DialogTitle>
                      <DialogDescription>
                        Enter the X/Twitter username of the article author to fix this URL.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 pt-4">
                      <div className="space-y-2">
                        <Label htmlFor="x-username">X Username</Label>
                        <Input
                          id="x-username"
                          placeholder="@username or username"
                          value={xArticleUsername}
                          onChange={(e) => setXArticleUsername(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && xArticleUsername.trim()) {
                              handleResolveXArticle(false)
                            }
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          The URL will be converted to: x.com/<span className="font-mono">{xArticleUsername || "username"}</span>/article/...
                        </p>
                      </div>

                      {xArticleError && (
                        <div className="flex items-center gap-2 text-sm text-red-500">
                          <AlertTriangle className="h-4 w-4" />
                          <span>{xArticleError}</span>
                        </div>
                      )}

                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          onClick={() => handleResolveXArticle(true)}
                          disabled={isResolvingXArticle}
                        >
                          {isResolvingXArticle ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Try Auto-Resolve
                        </Button>
                        <Button
                          onClick={() => handleResolveXArticle(false)}
                          disabled={isResolvingXArticle || !xArticleUsername.trim()}
                        >
                          {isResolvingXArticle ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : null}
                          Fix URL
                        </Button>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          </div>
        )}

        {link.contentSource === "wayback" && (
          <div className="flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
            <Archive className="h-4 w-4" />
            <span>Content fetched from </span>
            {link.archivedUrl ? (
              <a
                href={link.archivedUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                Wayback Machine archive
              </a>
            ) : (
              <span>Wayback Machine archive</span>
            )}
          </div>
        )}

        {archiveError && (
          <div className="flex items-center gap-2 text-sm text-red-500">
            <AlertTriangle className="h-4 w-4" />
            <span>Archive: {archiveError}</span>
          </div>
        )}

        {link.aiSummary && (
          <p className="text-muted-foreground">
            {searchTerm ? (
              <Highlighter
                searchWords={searchWords}
                autoEscape={true}
                textToHighlight={link.aiSummary}
                highlightClassName="bg-yellow-200 dark:bg-yellow-700 rounded px-0.5"
              />
            ) : (
              link.aiSummary
            )}
          </p>
        )}

        {link.aiKeyPoints?.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Key Points:</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {link.aiKeyPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </div>
        )}

        {link.highlightReason && (
          <p className="text-sm italic text-amber-600 dark:text-amber-400">
            &ldquo;{link.highlightReason}&rdquo;
          </p>
        )}

        {/* Expandable Article Content */}
        {hasExpandableContent && isContentExpanded && (
          <div className="mt-4 border-t pt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground mb-3">
              {hasArticleContent ? (
                <>
                  <BookOpen className="h-4 w-4" />
                  <span>Full Article Content</span>
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  <span>Email Context</span>
                </>
              )}
            </div>
            {link.contentHtml ? (
              <div
                className={cn(
                  "prose prose-zinc dark:prose-invert max-w-none",
                  "prose-p:text-[15px] prose-p:leading-[1.7] prose-p:mb-3",
                  "prose-headings:font-bold prose-headings:tracking-tight",
                  "prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3",
                  "prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2",
                  "prose-ul:my-3 prose-ol:my-3",
                  "prose-li:text-[15px] prose-li:leading-[1.7]",
                  "prose-blockquote:border-l-2 prose-blockquote:border-zinc-300 dark:prose-blockquote:border-zinc-600",
                  "prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:text-muted-foreground",
                  "prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline",
                  "prose-img:rounded-lg prose-img:my-3",
                )}
                dangerouslySetInnerHTML={{ __html: link.contentHtml }}
              />
            ) : link.contentText ? (
              <div className="space-y-3 text-[15px] leading-[1.7] text-muted-foreground">
                {link.contentText.split(/\n\n+/).filter(p => p.trim()).map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
            ) : link.email?.rawContent ? (
              // Show email content as fallback with prose styling
              <div
                className={cn(
                  "prose prose-zinc dark:prose-invert max-w-none",
                  "prose-p:text-[15px] prose-p:leading-[1.7] prose-p:mb-3",
                  "prose-headings:font-bold prose-headings:tracking-tight",
                  "prose-h2:text-lg prose-h2:mt-6 prose-h2:mb-3",
                  "prose-h3:text-base prose-h3:mt-4 prose-h3:mb-2",
                  "prose-ul:my-3 prose-ol:my-3",
                  "prose-li:text-[15px] prose-li:leading-[1.7]",
                  "prose-blockquote:border-l-2 prose-blockquote:border-zinc-300 dark:prose-blockquote:border-zinc-600",
                  "prose-blockquote:pl-3 prose-blockquote:italic prose-blockquote:text-muted-foreground",
                  "prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:underline",
                  "prose-img:rounded-lg prose-img:my-3",
                )}
                dangerouslySetInnerHTML={{
                  __html: link.email.rawContent
                    // Remove scripts and styles
                    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
                    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
                    // Remove tracking pixels and hidden images
                    .replace(/<img[^>]*(?:width|height)\s*=\s*["']?[01]["']?[^>]*>/gi, "")
                    // Remove event handlers
                    .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, "")
                }}
              />
            ) : null}
          </div>
        )}

        {isProcessing && (
          <p className="animate-pulse text-sm text-muted-foreground">
            Processing content...
          </p>
        )}

        {hasFailed && (
          <div className="space-y-2">
            <p className="text-sm text-red-500">Failed to fetch content</p>
            {hasEmailContent && !isContentExpanded && (
              <button
                onClick={() => setIsContentExpanded(true)}
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                <Mail className="h-3.5 w-3.5" />
                View email context instead
              </button>
            )}
          </div>
        )}
      </CardContent>

      <CardFooter className="flex flex-col gap-3">
        {/* Tag groupings */}
        <div className="flex flex-col gap-2 w-full">
          {/* Link Type Tags */}
          {link.linkTags?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium min-w-[60px]">Type:</span>
              {link.linkTags.map((tag) => (
                <Badge key={tag} variant="default" className="text-xs">
                  {tag.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}

          {/* Content Tags */}
          {link.contentTags?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium min-w-[60px]">Content:</span>
              {link.contentTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}

          {/* Metadata Tags */}
          {link.metadataTags?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium min-w-[60px]">Meta:</span>
              {link.metadataTags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
          )}

          {/* Legacy aiTags fallback (for links analyzed before this update) */}
          {!link.linkTags?.length && !link.contentTags?.length && link.aiTags?.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-medium min-w-[60px]">Tags:</span>
              {link.aiCategory && <Badge variant="secondary" className="text-xs">{link.aiCategory}</Badge>}
              {link.aiTags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center justify-end gap-2 w-full">
          {/* Read content button */}
          {hasArticleContent && (
            <Button
              variant={isContentExpanded ? "default" : "outline"}
              size="sm"
              onClick={() => setIsContentExpanded(!isContentExpanded)}
              className="gap-1.5"
            >
              {isContentExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Collapse
                </>
              ) : (
                <>
                  <BookOpen className="h-4 w-4" />
                  Read Content
                  {link.wordCount && (
                    <span className="text-xs opacity-70">({link.wordCount} words)</span>
                  )}
                </>
              )}
            </Button>
          )}

          {/* Email context button - shown when no article content but email exists */}
          {!hasArticleContent && hasEmailContent && (
            <Button
              variant={isContentExpanded ? "default" : "outline"}
              size="sm"
              onClick={() => setIsContentExpanded(!isContentExpanded)}
              className="gap-1.5"
            >
              {isContentExpanded ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Collapse
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Email Context
                </>
              )}
            </Button>
          )}

          {/* Mark as read/unread button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleRead}
            disabled={isTogglingRead}
          >
            {isTogglingRead ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : isRead ? (
              <>
                <EyeOff className="mr-1 h-4 w-4" />
                Mark Unread
              </>
            ) : (
              <>
                <Eye className="mr-1 h-4 w-4" />
                Mark Read
              </>
            )}
          </Button>

          {/* Refetch button - always available except during processing */}
          {!isProcessing && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefetch}
              disabled={isRefetching}
            >
              {isRefetching ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Refetching...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-1 h-4 w-4" />
                  Refetch
                </>
              )}
            </Button>
          )}

          {/* Try Archive / Refetch Archive button - for paywalled, failed, or already-archived links */}
          {(hasPaywall || hasFailed || link.isPaywalled || link.contentSource === "wayback") && !isProcessing && (
            <Button
              variant={link.contentSource === "wayback" ? "ghost" : "outline"}
              size="sm"
              onClick={handleFetchFromArchive}
              disabled={isFetchingArchive}
            >
              {isFetchingArchive ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  {link.contentSource === "wayback" ? "Refetching..." : "Checking Archive..."}
                </>
              ) : (
                <>
                  <Archive className="mr-1 h-4 w-4" />
                  {link.contentSource === "wayback" ? "Refetch Archive" : "Try Archive"}
                </>
              )}
            </Button>
          )}

          {/* Analyze buttons */}
          {needsAnalysis ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1 h-4 w-4" />
                  Analyze
                </>
              )}
            </Button>
          ) : hasBeenAnalyzed && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? (
                <>
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  Re-analyzing...
                </>
              ) : (
                <>
                  <Sparkles className="mr-1 h-4 w-4" />
                  Re-analyze
                </>
              )}
            </Button>
          )}

          {/* View Raw HTML button */}
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm" onClick={handleLoadRawContent}>
                <Code className="mr-1 h-4 w-4" />
                Raw
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[80vh]">
              <DialogHeader>
                <DialogTitle>Raw Content</DialogTitle>
                <DialogDescription>
                  {link.finalUrl || link.url}
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-auto max-h-[60vh] rounded border bg-muted p-4">
                {isLoadingRaw ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </div>
                ) : (
                  <pre className="text-xs whitespace-pre-wrap font-mono">
                    {rawContent || "No content loaded"}
                  </pre>
                )}
              </div>
            </DialogContent>
          </Dialog>

          {gmailUrl && (
            <Button variant="ghost" size="sm" asChild>
              <a href={gmailUrl} target="_blank" rel="noopener noreferrer">
                <Mail className="mr-1 h-4 w-4" />
                View Email
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <a href={link.finalUrl || link.url} target="_blank" rel="noopener noreferrer">
              Read Article
              <ExternalLink className="ml-1 h-4 w-4" />
            </a>
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
