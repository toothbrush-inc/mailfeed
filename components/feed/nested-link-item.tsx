"use client"

import { useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  ExternalLink,
  Clock,
  AlertTriangle,
  Loader2,
  Star,
  Archive,
  ArchiveRestore,
  Twitter,
  Flag,
  CheckCircle,
  Heart,
  ArrowUpFromLine,
} from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LinkDebugDialog } from "./link-debug-dialog"
import { FEATURE_FLAGS } from "@/lib/flags"

interface NestedLinkItemProps {
  link: {
    id: string
    url: string
    title: string | null
    domain: string | null
    finalUrl: string | null
    finalDomain: string | null
    wasRedirected: boolean
    aiSummary: string | null
    aiKeyPoints?: string[]
    aiCategory: string | null
    aiTags: string[]
    linkTags: string[]
    contentTags: string[]
    metadataTags: string[]
    fetchStatus: string
    fetchError: string | null
    fetchedAt: string | null
    analyzedAt: string | null
    isHighlighted: boolean
    highlightReason: string | null
    isRead: boolean
    isLiked: boolean
    readingTimeMin: number | null
    imageUrl: string | null
    isPaywalled: boolean
    paywallType: string | null
    foundVia?: string | null
    foundRole?: string | null
    /** Links nested under this one: what a podcast episode's show notes link. */
    childLinks?: Array<{
      id: string
      url: string
      finalUrl: string | null
      title: string | null
      domain: string | null
      finalDomain: string | null
    }>
    contentSource: string | null
    archivedUrl: string | null
    wordCount: number | null
    embeddingStatus: string | null
    embeddedAt: string | null
    embeddingError: string | null
    createdAt: string
    updatedAt: string
  }
  onUpdate?: () => void
}

export function NestedLinkItem({ link, onUpdate }: NestedLinkItemProps) {
  const [isTogglingRead, setIsTogglingRead] = useState(false)
  const [isRead, setIsRead] = useState(link.isRead)
  const [isLiked, setIsLiked] = useState(link.isLiked)
  const [isTogglingLike, setIsTogglingLike] = useState(false)
  const [isResolvingXArticle, setIsResolvingXArticle] = useState(false)
  const [xArticleUsername, setXArticleUsername] = useState("")
  const [xArticleError, setXArticleError] = useState<string | null>(null)
  const [xArticleDialogOpen, setXArticleDialogOpen] = useState(false)
  const [isReporting, setIsReporting] = useState(false)
  const [hasReported, setHasReported] = useState(false)
  const [reportDialogOpen, setReportDialogOpen] = useState(false)

  // Check if this is an X article URL that needs resolution
  const isXArticleUrl = /^https?:\/\/(x\.com|twitter\.com)\/i\/article\/\d+/i.test(link.url)
  const needsXResolution = isXArticleUrl && !link.finalUrl

  const isProcessing = ["PENDING", "FETCHING", "ANALYZING"].includes(link.fetchStatus)
  const hasFailed = link.fetchStatus === "FAILED"

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
      onUpdate?.()
    } catch (error) {
      console.error("Failed to toggle read status:", error)
    } finally {
      setIsTogglingRead(false)
    }
  }

  // Optimistic like toggle; never touches read state
  const handleToggleLike = async () => {
    const next = !isLiked
    setIsLiked(next)
    setIsTogglingLike(true)
    try {
      const response = await fetch(`/api/links/${link.id}/like`, {
        method: next ? "POST" : "DELETE",
      })
      if (!response.ok) throw new Error("Failed to update like")
      onUpdate?.()
    } catch (error) {
      setIsLiked(!next)
      console.error("Failed to toggle like:", error)
    } finally {
      setIsTogglingLike(false)
    }
  }

  const handleReport = async () => {
    setIsReporting(true)
    try {
      const response = await fetch(`/api/links/${link.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Content fetch/parse issue" }),
      })
      if (!response.ok) {
        throw new Error("Failed to submit report")
      }
      setHasReported(true)
      setReportDialogOpen(false)
    } catch (error) {
      console.error("Failed to report link:", error)
    } finally {
      setIsReporting(false)
    }
  }

  // Make a link from the show notes a feed link of its own: fetched and analyzed
  const [movingId, setMovingId] = useState<string | null>(null)
  const [moveMessage, setMoveMessage] = useState<string | null>(null)
  const moveToFeed = async (id: string) => {
    setMovingId(id)
    setMoveMessage(null)
    try {
      const response = await fetch(`/api/links/${id}/move-to-feed`, { method: "POST" })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Couldn't move the link")
      if (data.message) setMoveMessage(data.message)
      onUpdate?.()
    } catch (error) {
      setMoveMessage(error instanceof Error ? error.message : "Couldn't move the link")
    } finally {
      setMovingId(null)
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
      onUpdate?.()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resolve X article URL"
      setXArticleError(message)
    } finally {
      setIsResolvingXArticle(false)
    }
  }

  const displayDomain = link.finalDomain || link.domain

  return (
    <div
      className={cn(
        "rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50",
        FEATURE_FLAGS.enableAnalysis && link.isHighlighted && "ring-2 ring-amber-400 dark:ring-amber-500",
        isRead && "opacity-60"
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        {FEATURE_FLAGS.enableAnalysis && link.isHighlighted && (
          <Star className="h-4 w-4 mt-1 text-amber-500 fill-amber-500 shrink-0" />
        )}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Title and domain */}
          <div className="space-y-1">
            {FEATURE_FLAGS.enableAnalysis && link.isHighlighted && (
              <div className="flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                <span>Highlighted</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <a
                href={link.finalUrl || link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium hover:underline line-clamp-2"
              >
                {link.title || link.finalUrl || link.url}
              </a>
              <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{displayDomain}</span>
              {link.foundVia === "SHOW_NOTES" && (
                <>
                  <span>·</span>
                  <span>From the show notes</span>
                </>
              )}
              {link.foundVia === "QUOTED_POST" && (
                <>
                  <span>·</span>
                  <span>From the quoted post</span>
                </>
              )}
              {link.foundVia === "AI_LOOKUP" && (
                <>
                  <span>·</span>
                  {link.foundRole === "BOOK" ? (
                    <span title="A book named here, matched in Open Library by title and author.">
                      Book mentioned here
                    </span>
                  ) : (
                    <span title="Found by searching for what this post is about. It may be the wrong one.">
                      Found by AI: probably the{" "}
                      {link.foundRole === "CLIP"
                        ? "same clip"
                        : link.foundRole === "EPISODE"
                          ? "podcast episode"
                          : "full recording"}
                    </span>
                  )}
                </>
              )}
              {link.readingTimeMin && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {link.readingTimeMin} min
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Image */}
          {link.imageUrl && (
            <img
              src={link.imageUrl}
              alt=""
              className="h-32 w-full rounded-md object-cover"
            />
          )}

          {/* Status indicators */}
          {/* Paywall type indicator hidden for now */}

          {link.contentSource === "wayback" && (
            <div className="flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400">
              <Archive className="h-3 w-3" />
              <span>From archive</span>
            </div>
          )}

          {isProcessing && (
            <p className="animate-pulse text-xs text-muted-foreground">
              Processing...
            </p>
          )}

          {hasFailed && (
            <p className="text-xs text-red-500">Failed to fetch</p>
          )}

          {/* X Article URL resolution prompt */}
          {needsXResolution && (
            <div className="rounded border border-blue-200 bg-blue-50 p-2 dark:border-blue-800 dark:bg-blue-950">
              <div className="flex items-start gap-2">
                <Twitter className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
                    X Article URL needs resolution
                  </p>
                  <Dialog open={xArticleDialogOpen} onOpenChange={setXArticleDialogOpen}>
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="h-6 text-xs">
                        <Twitter className="mr-1 h-3 w-3" />
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
                          <Label htmlFor={`x-username-${link.id}`}>X Username</Label>
                          <Input
                            id={`x-username-${link.id}`}
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
                            {isResolvingXArticle && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Try Auto-Resolve
                          </Button>
                          <Button
                            onClick={() => handleResolveXArticle(false)}
                            disabled={isResolvingXArticle || !xArticleUsername.trim()}
                          >
                            {isResolvingXArticle && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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

          {/* What a podcast episode's show notes link, kept compact: these are references */}
          {link.childLinks && link.childLinks.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                From the show notes ({link.childLinks.length})
              </p>
              <ul className="space-y-0.5 text-sm">
                {link.childLinks.map((noteLink) => (
                  <li key={noteLink.id} className="flex items-baseline gap-2">
                    <a
                      href={noteLink.finalUrl || noteLink.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="min-w-0 truncate hover:underline"
                    >
                      {noteLink.title || noteLink.finalUrl || noteLink.url}
                    </a>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {(noteLink.finalDomain || noteLink.domain || "").replace(/^www\./, "")}
                    </span>
                    <button
                      type="button"
                      onClick={() => moveToFeed(noteLink.id)}
                      disabled={movingId !== null}
                      title="Fetch this page and analyze it as a link of its own in your feed"
                      className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline disabled:opacity-60"
                    >
                      {movingId === noteLink.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <ArrowUpFromLine className="h-3 w-3" />
                      )}
                      Move to feed
                    </button>
                  </li>
                ))}
              </ul>
              {moveMessage && <p className="text-xs text-muted-foreground">{moveMessage}</p>}
            </div>
          )}

          {/* AI Summary */}
          {FEATURE_FLAGS.enableAnalysis && link.aiSummary && (
            <p className="text-sm text-muted-foreground">{link.aiSummary}</p>
          )}

          {/* Key Points */}
          {FEATURE_FLAGS.enableAnalysis && link.aiKeyPoints && link.aiKeyPoints.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium">Key Points:</p>
              <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                {link.aiKeyPoints.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Highlight reason */}
          {FEATURE_FLAGS.enableAnalysis && link.isHighlighted && link.highlightReason && (
            <p className="text-xs italic text-amber-600 dark:text-amber-400">
              &ldquo;{link.highlightReason}&rdquo;
            </p>
          )}

          {/* Tags */}
          {FEATURE_FLAGS.enableAnalysis && <div className="flex flex-col gap-1.5 pt-1">
            {link.linkTags?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground font-medium">Type:</span>
                {link.linkTags.map((tag) => (
                  <Badge key={tag} variant="default" className="text-xs">
                    {tag.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}
            {link.contentTags?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground font-medium">Content:</span>
                {link.contentTags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">
                    {tag.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}
            {link.metadataTags && link.metadataTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs text-muted-foreground font-medium">Meta:</span>
                {link.metadataTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag.replace(/_/g, " ")}
                  </Badge>
                ))}
              </div>
            )}
            {/* Legacy tags fallback */}
            {!link.linkTags?.length && !link.contentTags?.length && link.aiTags?.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                {link.aiCategory && (
                  <Badge variant="secondary" className="text-xs">{link.aiCategory}</Badge>
                )}
                {link.aiTags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
          </div>}

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-1 pt-2">
            {link.foundVia === "SHOW_NOTES" && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => moveToFeed(link.id)}
                disabled={movingId !== null}
                title="Fetch this page and analyze it as a link of its own in your feed"
              >
                {movingId === link.id ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <ArrowUpFromLine className="mr-1 h-3 w-3" />
                )}
                Move to feed
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleToggleRead}
              disabled={isTogglingRead}
            >
              {isTogglingRead ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : isRead ? (
                <ArchiveRestore className="mr-1 h-3 w-3" />
              ) : (
                <Archive className="mr-1 h-3 w-3" />
              )}
              {isRead ? "Mark as unread" : "Mark as read"}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={handleToggleLike}
              disabled={isTogglingLike}
              aria-pressed={isLiked}
              aria-label={isLiked ? "Unlike" : "Like"}
              title={isLiked ? "Unlike" : "Like"}
            >
              <Heart className={cn("h-3 w-3", isLiked && "fill-current text-rose-500")} />
            </Button>

            {/* Report Broken Link button */}
            {!isProcessing && (
              <Dialog open={reportDialogOpen} onOpenChange={setReportDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={cn("h-7 text-xs", hasReported && "text-green-600 dark:text-green-400")}
                    disabled={hasReported}
                  >
                    {hasReported ? (
                      <>
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Reported
                      </>
                    ) : (
                      <>
                        <Flag className="mr-1 h-3 w-3" />
                        Report
                      </>
                    )}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Report Broken Link</DialogTitle>
                    <DialogDescription>
                      This flags the link as having content fetch or parse issues. The link will be queued for re-processing with alternative fetching strategies.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button
                      onClick={handleReport}
                      disabled={isReporting}
                    >
                      {isReporting ? (
                        <>
                          <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          Reporting...
                        </>
                      ) : (
                        "Report"
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}

            <LinkDebugDialog linkId={link.id} linkUrl={link.url} link={link} onPromoteAttempt={onUpdate} onAction={onUpdate} />
          </div>
        </div>
      </div>
    </div>
  )
}
