"use client"

import { useState } from "react"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Mail, ExternalLink, Clock, AlertTriangle, Sparkles, Loader2 } from "lucide-react"

interface FeedItemProps {
  link: {
    id: string
    url: string
    title: string | null
    domain: string | null
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
    createdAt: string
    email: {
      gmailId: string
      subject: string | null
      receivedAt: string
    } | null
  }
  onAnalyzeComplete?: () => void
}

export function FeedItem({ link, onAnalyzeComplete }: FeedItemProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const isProcessing = ["PENDING", "FETCHING", "ANALYZING"].includes(link.fetchStatus)
  const hasFailed = link.fetchStatus === "FAILED"
  const hasBeenAnalyzed = link.linkTags?.length > 0 || link.contentTags?.length > 0 || link.aiCategory
  const needsAnalysis = link.fetchStatus === "FETCHED" && !hasBeenAnalyzed
  const gmailUrl = link.email?.gmailId
    ? `https://mail.google.com/mail/u/0/#inbox/${link.email.gmailId}`
    : null

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

  return (
    <Card
      className={cn(
        "transition-all hover:shadow-md",
        link.isHighlighted && "ring-2 ring-amber-400 dark:ring-amber-500"
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
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                {link.title || link.url}
              </a>
            </h3>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{link.domain}</span>
              {link.readingTimeMin && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {link.readingTimeMin} min read
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

        {link.aiSummary && (
          <p className="text-muted-foreground">{link.aiSummary}</p>
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

        {isProcessing && (
          <p className="animate-pulse text-sm text-muted-foreground">
            Processing content...
          </p>
        )}

        {hasFailed && (
          <p className="text-sm text-red-500">Failed to fetch content</p>
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
          {gmailUrl && (
            <Button variant="ghost" size="sm" asChild>
              <a href={gmailUrl} target="_blank" rel="noopener noreferrer">
                <Mail className="mr-1 h-4 w-4" />
                View Email
              </a>
            </Button>
          )}
          <Button variant="ghost" size="sm" asChild>
            <a href={link.url} target="_blank" rel="noopener noreferrer">
              Read Article
              <ExternalLink className="ml-1 h-4 w-4" />
            </a>
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
