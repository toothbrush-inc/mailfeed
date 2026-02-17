"use client"

import { useState } from "react"
import useSWR from "swr"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, AlertCircle, CheckCircle, Brain, KeyRound, RotateCcw } from "lucide-react"
import { useSettings } from "@/hooks/use-settings"

interface AnalyzeStatus {
  total: number
  analyzed: number
  needsAnalysis: number
  analyzing: number
  failed: number
  notReady: number
  aiConfigured: boolean
  coverage: number
}

interface AnalyzeResult {
  processed: number
  succeeded: number
  failed: number
  skipped: number
  hasMore: boolean
  errors: string[]
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function AnalyzeSection() {
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isReanalyzing, setIsReanalyzing] = useState(false)
  const [lastResult, setLastResult] = useState<AnalyzeResult | null>(null)
  const [aiNotConfigured, setAiNotConfigured] = useState(false)
  const { requiredEnvVar } = useSettings()

  const { data: status, mutate } = useSWR<AnalyzeStatus>(
    "/api/analyze/status",
    fetcher,
    { refreshInterval: isAnalyzing || isReanalyzing ? 2000 : 0 }
  )

  const handleAnalyze = async (reanalyze = false) => {
    const setLoading = reanalyze ? setIsReanalyzing : setIsAnalyzing
    setLoading(true)
    setLastResult(null)

    try {
      const params = reanalyze ? "limit=10&reanalyze=true" : "limit=10"
      const response = await fetch(`/api/analyze/bulk?${params}`, {
        method: "POST",
      })
      const data = await response.json()

      if (data.code === "AI_NOT_CONFIGURED") {
        setAiNotConfigured(true)
        setLoading(false)
        return
      }

      const result: AnalyzeResult = data
      setLastResult(result)
      mutate()

      // If there are more to process, continue automatically
      if (result.hasMore && result.succeeded > 0) {
        setTimeout(() => handleAnalyze(reanalyze), 500)
        return
      }
    } catch (error) {
      console.error("Failed to run bulk analysis:", error)
    } finally {
      setLoading(false)
    }
  }

  if (!status) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Content Analysis
          </CardTitle>
          <CardDescription>Loading analysis status...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  const isAiMissing = aiNotConfigured || !status.aiConfigured
  const coveragePercent = Math.round(status.coverage * 100)
  const isRunning = isAnalyzing || isReanalyzing
  const eligible = status.total - status.failed - status.notReady
  const needsWork = status.needsAnalysis > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5" />
          Content Analysis
        </CardTitle>
        <CardDescription>
          Analyze fetched link content with AI to generate summaries, tags, and categories.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAiMissing && (
          <div className="flex items-start gap-3 rounded-md bg-amber-50 p-4 dark:bg-amber-950">
            <KeyRound className="h-5 w-5 mt-0.5 text-amber-500 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                AI API Key Required
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                To analyze content, add <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900">{requiredEnvVar || "GEMINI_API_KEY"}</code> to your <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900">.env</code> file and restart the server.
              </p>
            </div>
          </div>
        )}

        {/* Stats grid */}
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
            <p className="text-xl font-bold">{coveragePercent}%</p>
            <p className="text-xs text-muted-foreground">Coverage</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
            <p className="text-xl font-bold">{status.analyzed}</p>
            <p className="text-xs text-muted-foreground">Analyzed</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
            <p className="text-xl font-bold">{status.needsAnalysis}</p>
            <p className="text-xs text-muted-foreground">Needs Analysis</p>
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
              className="h-full bg-violet-500 transition-all duration-500"
              style={{ width: `${coveragePercent}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {status.analyzed} of {eligible} eligible links analyzed
            {status.analyzing > 0 && ` (${status.analyzing} in progress)`}
            {status.notReady > 0 && ` · ${status.notReady} not yet fetched`}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <Button
            onClick={() => handleAnalyze(false)}
            disabled={isRunning || !needsWork || isAiMissing}
            size="sm"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : needsWork ? (
              <>
                <Brain className="mr-2 h-4 w-4" />
                Analyze Links
              </>
            ) : (
              <>
                <CheckCircle className="mr-2 h-4 w-4" />
                All Done
              </>
            )}
          </Button>

          {status.analyzed > 0 && !isRunning && (
            <Button
              onClick={() => handleAnalyze(true)}
              disabled={isRunning || isAiMissing}
              size="sm"
              variant="outline"
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Re-analyze All
            </Button>
          )}

          {lastResult && !isRunning && (
            <p className="text-sm text-muted-foreground">
              Processed {lastResult.processed}: {lastResult.succeeded} succeeded
              {lastResult.failed > 0 && `, ${lastResult.failed} failed`}
              {lastResult.skipped > 0 && `, ${lastResult.skipped} skipped`}
            </p>
          )}
        </div>

        {/* Errors */}
        {lastResult?.errors && lastResult.errors.length > 0 && (
          <div className="rounded-md bg-red-50 p-3 text-sm dark:bg-red-950">
            <p className="font-medium text-red-700 dark:text-red-300">
              Some analyses failed:
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
      </CardContent>
    </Card>
  )
}
