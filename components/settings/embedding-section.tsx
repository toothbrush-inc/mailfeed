"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, AlertCircle, CheckCircle, Sparkles } from "lucide-react"

interface EmbeddingStatus {
  pgvectorAvailable: boolean
  total: number
  embedded: number
  pending: number
  processing: number
  failed: number
  skipped: number
  coverage: number
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
  const [isGenerating, setIsGenerating] = useState(false)
  const [lastResult, setLastResult] = useState<GenerateResult | null>(null)

  const { data: status, mutate } = useSWR<EmbeddingStatus>(
    "/api/embeddings/status",
    fetcher,
    { refreshInterval: isGenerating ? 2000 : 0 }
  )

  const handleGenerate = async () => {
    setIsGenerating(true)
    setLastResult(null)

    try {
      const response = await fetch("/api/embeddings/generate?limit=50", {
        method: "POST",
      })
      const result: GenerateResult = await response.json()
      setLastResult(result)
      mutate()

      // If there are more to process, continue automatically
      if (result.hasMore && result.succeeded > 0) {
        // Small delay before continuing
        setTimeout(() => handleGenerate(), 500)
        return
      }
    } catch (error) {
      console.error("Failed to generate embeddings:", error)
    } finally {
      setIsGenerating(false)
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

  const coveragePercent = Math.round(status.coverage * 100)
  const needsEmbeddings = status.pending > 0 || status.failed > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          Semantic Search
        </CardTitle>
        <CardDescription>
          Enable AI-powered semantic search for your saved links using embeddings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
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
            {/* Coverage stats */}
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <p className="text-xl font-bold">{coveragePercent}%</p>
                <p className="text-xs text-muted-foreground">Coverage</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <p className="text-xl font-bold">{status.embedded}</p>
                <p className="text-xs text-muted-foreground">Embedded</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <p className="text-xl font-bold">{status.pending}</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
              <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
                <p className="text-xl font-bold">{status.failed}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1">
              <div className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <div
                  className="h-full bg-emerald-500 transition-all duration-500"
                  style={{ width: `${coveragePercent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {status.embedded} of {status.total - status.skipped} links embedded
                {status.skipped > 0 && ` (${status.skipped} skipped - no content)`}
              </p>
            </div>

            {/* Generate button */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !needsEmbeddings}
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : needsEmbeddings ? (
                  <>
                    <Sparkles className="mr-2 h-4 w-4" />
                    Generate Embeddings
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    All Done
                  </>
                )}
              </Button>

              {lastResult && !isGenerating && (
                <p className="text-sm text-muted-foreground">
                  Processed {lastResult.processed}: {lastResult.succeeded} succeeded,{" "}
                  {lastResult.failed} failed, {lastResult.skipped} skipped
                </p>
              )}
            </div>

            {/* Errors */}
            {lastResult?.errors && lastResult.errors.length > 0 && (
              <div className="rounded-md bg-red-50 p-3 text-sm dark:bg-red-950">
                <p className="font-medium text-red-700 dark:text-red-300">
                  Some embeddings failed:
                </p>
                <ul className="mt-1 list-inside list-disc text-red-600 dark:text-red-400">
                  {lastResult.errors.slice(0, 5).map((error, i) => (
                    <li key={i} className="truncate">{error}</li>
                  ))}
                  {lastResult.errors.length > 5 && (
                    <li>...and {lastResult.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
