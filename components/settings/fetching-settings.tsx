"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Loader2, Globe, ArrowUp, ArrowDown, Check } from "lucide-react"
import { useSettings } from "@/hooks/use-settings"

const AVAILABLE_FETCHERS = [
  { id: "direct", name: "Direct Fetch", description: "Fetches content directly from the URL" },
  { id: "wayback", name: "Wayback Machine", description: "Uses Internet Archive's cached version" },
]

export function FetchingSettings() {
  const { settings, updateSettings } = useSettings()
  const [isSaving, setIsSaving] = useState(false)
  const [chain, setChain] = useState<string[]>([])
  const [timeoutMs, setTimeoutMs] = useState(30000)
  const [initialized, setInitialized] = useState(false)

  if (settings && !initialized) {
    setChain(settings.fetching.fallbackChain)
    setTimeoutMs(settings.fetching.fetchTimeoutMs)
    setInitialized(true)
  }

  if (!settings) return null

  const hasChanges =
    JSON.stringify(chain) !== JSON.stringify(settings.fetching.fallbackChain) ||
    timeoutMs !== settings.fetching.fetchTimeoutMs

  const toggleFetcher = (id: string) => {
    if (chain.includes(id)) {
      // Don't allow removing the last fetcher
      if (chain.length <= 1) return
      setChain(chain.filter((f) => f !== id))
    } else {
      setChain([...chain, id])
    }
  }

  const moveFetcher = (index: number, direction: "up" | "down") => {
    const newChain = [...chain]
    const newIndex = direction === "up" ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= newChain.length) return
    ;[newChain[index], newChain[newIndex]] = [newChain[newIndex], newChain[index]]
    setChain(newChain)
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await updateSettings({
        fetching: { fallbackChain: chain, fetchTimeoutMs: timeoutMs },
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          Content Fetching
        </CardTitle>
        <CardDescription>
          Configure the fallback chain for fetching link content. If the first method fails, the next is tried automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label>Fallback Chain (in order)</Label>
          <div className="space-y-2">
            {chain.map((fetcherId, index) => {
              const fetcher = AVAILABLE_FETCHERS.find((f) => f.id === fetcherId)
              if (!fetcher) return null
              return (
                <div
                  key={fetcherId}
                  className="flex items-center gap-2 rounded-md border p-3"
                >
                  <span className="text-xs font-medium text-muted-foreground w-5">
                    {index + 1}.
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium">{fetcher.name}</p>
                    <p className="text-xs text-muted-foreground">{fetcher.description}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => moveFetcher(index, "up")}
                      disabled={index === 0}
                    >
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => moveFetcher(index, "down")}
                      disabled={index === chain.length - 1}
                    >
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Available fetchers not in chain */}
          {AVAILABLE_FETCHERS.filter((f) => !chain.includes(f.id)).map((fetcher) => (
            <button
              key={fetcher.id}
              onClick={() => toggleFetcher(fetcher.id)}
              className="flex w-full items-center gap-2 rounded-md border border-dashed p-3 text-left opacity-50 hover:opacity-75 transition-opacity"
            >
              <span className="text-xs font-medium text-muted-foreground w-5">+</span>
              <div className="flex-1">
                <p className="text-sm font-medium">{fetcher.name}</p>
                <p className="text-xs text-muted-foreground">{fetcher.description}</p>
              </div>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          <Label htmlFor="timeout">Fetch Timeout: {Math.round(timeoutMs / 1000)}s</Label>
          <input
            id="timeout"
            type="range"
            min={5000}
            max={60000}
            step={1000}
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(parseInt(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>5s</span>
            <span>60s</span>
          </div>
        </div>

        {hasChanges && (
          <Button onClick={handleSave} disabled={isSaving} size="sm">
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Check className="mr-2 h-4 w-4" />
                Save Fetching Settings
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
