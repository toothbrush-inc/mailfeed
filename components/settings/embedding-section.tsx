"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, AlertCircle, CheckCircle, Sparkles } from "lucide-react"

interface StatusCounts {
  total: number
  embedded: number
  pending: number
  processing: number
  failed: number
  skipped: number
  coverage: number
}

interface EmbeddingStatus {
  pgvectorAvailable: boolean
  links: StatusCounts
  emails: StatusCounts
}

interface GenerateResult {
  processed: number
  succeeded: number
  failed: number
  skipped: number
  hasMore: boolean
  errors: string[]
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function EmbeddingSection() {
  const [isGeneratingLinks, setIsGeneratingLinks] = useState(false)
  const [isGeneratingEmails, setIsGeneratingEmails] = useState(false)
  const [lastLinkResult, setLastLinkResult] = useState<GenerateResult | null>(null)
  const [lastEmailResult, setLastEmailResult] = useState<GenerateResult | null>(null)

  const { data: status, mutate } = useSWR<EmbeddingStatus>(
    "/api/embeddings/status",
    fetcher,
    { refreshInterval: isGeneratingLinks || isGeneratingEmails ? 2000 : 0 }
  )

  const handleGenerateLinks = async () => {
    setIsGeneratingLinks(true)
    setLastLinkResult(null)

    try {
      const response = await fetch("/api/embeddings/generate?limit=50", {
        method: "POST",
      })
      const result: GenerateResult = await response.json()
      setLastLinkResult(result)
      mutate()

      // If there are more to process, continue automatically
      if (result.hasMore && result.succeeded > 0) {
        // Small delay before continuing
        setTimeout(() => handleGenerateLinks(), 500)
        return
      }
    } catch (error) {
      console.error("Failed to generate link embeddings:", error)
    } finally {
      setIsGeneratingLinks(false)
    }
  }

  const handleGenerateEmails = async () => {
    setIsGeneratingEmails(true)
    setLastEmailResult(null)

    try {
      const response = await fetch("/api/embeddings/generate-emails?limit=50", {
        method: "POST",
      })
      const result: GenerateResult = await response.json()
      setLastEmailResult(result)
      mutate()

      // If there are more to process, continue automatically
      if (result.hasMore && result.succeeded > 0) {
        // Small delay before continuing
        setTimeout(() => handleGenerateEmails(), 500)
        return
      }
    } catch (error) {
      console.error("Failed to generate email embeddings:", error)
    } finally {
      setIsGeneratingEmails(false)
    }
  }

  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Semantic Search
          </CardTitle>
          <CardDescription>Loading embedding status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const linkCoveragePercent = Math.round(status.links.coverage * 100)
  const emailCoveragePercent = Math.round(status.emails.coverage * 100)
  const needsLinkEmbeddings = status.links.pending > 0 || status.links.failed > 0
  const needsEmailEmbeddings = status.emails.pending > 0 || status.emails.failed > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Semantic Search
        </CardTitle>
        <CardDescription>
          Enable AI-powered semantic search for your saved links and emails using embeddings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!status.pgvectorAvailable ? (
          <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm dark:bg-amber-950">
            <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500" />
            <div>
              <p className="font-medium text-amber-700 dark:text-amber-300">
                pgvector not installed
              </p>
              <p className="text-amber-600 dark:text-amber-400">
                Install the pgvector PostgreSQL extension to enable semantic search.
                See the migration file for instructions.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Links Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Links</h3>

              {/* Link stats */}
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <p className="text-xl font-bold">{linkCoveragePercent}%</p>
                  <p className="text-xs text-muted-foreground">Coverage</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <p className="text-xl font-bold">{status.links.embedded}</p>
                  <p className="text-xs text-muted-foreground">Embedded</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <p className="text-xl font-bold">{status.links.pending}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <p className="text-xl font-bold">{status.links.failed}</p>
                  <p className="text-xs text-muted-foreground">Failed</p>
                </div>
              </div>

              {/* Link progress bar */}
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-full bg-emerald-500 transition-all duration-500"
                    style={{ width: `${linkCoveragePercent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {status.links.embedded} of {status.links.total - status.links.skipped} links embedded
                  {status.links.skipped > 0 && ` (${status.links.skipped} skipped - no content)`}
                </p>
              </div>

              {/* Link generate button */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleGenerateLinks}
                  disabled={isGeneratingLinks || !needsLinkEmbeddings}
                  size="sm"
                >
                  {isGeneratingLinks ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : needsLinkEmbeddings ? (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Link Embeddings
                    </>
                  ) : (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      All Done
                    </>
                  )}
                </Button>

                {lastLinkResult && !isGeneratingLinks && (
                  <p className="text-sm text-muted-foreground">
                    Processed {lastLinkResult.processed}: {lastLinkResult.succeeded} succeeded,{" "}
                    {lastLinkResult.failed} failed, {lastLinkResult.skipped} skipped
                  </p>
                )}
              </div>

              {/* Link errors */}
              {lastLinkResult?.errors && lastLinkResult.errors.length > 0 && (
                <div className="rounded-md bg-red-50 p-3 text-sm dark:bg-red-950">
                  <p className="font-medium text-red-700 dark:text-red-300">
                    Some embeddings failed:
                  </p>
                  <ul className="mt-1 list-inside list-disc text-red-600 dark:text-red-400">
                    {lastLinkResult.errors.slice(0, 5).map((error, i) => (
                      <li key={i} className="truncate">{error}</li>
                    ))}
                    {lastLinkResult.errors.length > 5 && (
                      <li>...and {lastLinkResult.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* Emails Section */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Emails</h3>

              {/* Email stats */}
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <p className="text-xl font-bold">{emailCoveragePercent}%</p>
                  <p className="text-xs text-muted-foreground">Coverage</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <p className="text-xl font-bold">{status.emails.embedded}</p>
                  <p className="text-xs text-muted-foreground">Embedded</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <p className="text-xl font-bold">{status.emails.pending}</p>
                  <p className="text-xs text-muted-foreground">Pending</p>
                </div>
                <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                  <p className="text-xl font-bold">{status.emails.failed}</p>
                  <p className="text-xs text-muted-foreground">Failed</p>
                </div>
              </div>

              {/* Email progress bar */}
              <div className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${emailCoveragePercent}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {status.emails.embedded} of {status.emails.total - status.emails.skipped} emails embedded
                  {status.emails.skipped > 0 && ` (${status.emails.skipped} skipped - no content)`}
                </p>
              </div>

              {/* Email generate button */}
              <div className="flex items-center gap-3">
                <Button
                  onClick={handleGenerateEmails}
                  disabled={isGeneratingEmails || !needsEmailEmbeddings}
                  size="sm"
                >
                  {isGeneratingEmails ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : needsEmailEmbeddings ? (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate Email Embeddings
                    </>
                  ) : (
                    <>
                      <CheckCircle className="mr-2 h-4 w-4" />
                      All Done
                    </>
                  )}
                </Button>

                {lastEmailResult && !isGeneratingEmails && (
                  <p className="text-sm text-muted-foreground">
                    Processed {lastEmailResult.processed}: {lastEmailResult.succeeded} succeeded,{" "}
                    {lastEmailResult.failed} failed, {lastEmailResult.skipped} skipped
                  </p>
                )}
              </div>

              {/* Email errors */}
              {lastEmailResult?.errors && lastEmailResult.errors.length > 0 && (
                <div className="rounded-md bg-red-50 p-3 text-sm dark:bg-red-950">
                  <p className="font-medium text-red-700 dark:text-red-300">
                    Some embeddings failed:
                  </p>
                  <ul className="mt-1 list-inside list-disc text-red-600 dark:text-red-400">
                    {lastEmailResult.errors.slice(0, 5).map((error, i) => (
                      <li key={i} className="truncate">{error}</li>
                    ))}
                    {lastEmailResult.errors.length > 5 && (
                      <li>...and {lastEmailResult.errors.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
