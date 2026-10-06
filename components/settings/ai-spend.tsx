"use client"

import { useEffect, useState } from "react"
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Coins, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAiUsage, type AiUsage } from "@/hooks/use-ai-usage"
import { cn } from "@/lib/utils"

const RANGES = [7, 30, 90] as const

const KIND_LABELS: Record<string, string> = {
  ANALYZE_LINK: "Link analysis",
  INGEST_EMAIL: "Email ingest",
  CHAT: "Chat",
  MEDIA_LOOKUP: "Source lookup",
}

// Sub-cent amounts matter here: a link can cost a fraction of a cent.
function usd(n: number): string {
  if (n === 0) return "$0.00"
  if (n < 0.01) return `$${n.toFixed(4)}`
  if (n < 1) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}

function formatDay(date: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", opts)
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

interface DayTooltipProps {
  active?: boolean
  payload?: Array<{ payload: AiUsage["daily"][number] }>
}

function DayTooltip({ active, payload }: DayTooltipProps) {
  if (!active || !payload?.length) return null
  const day = payload[0].payload
  return (
    <div className="rounded-lg border bg-background p-2 shadow-sm">
      <p className="text-sm font-medium">{formatDay(day.date, { month: "short", day: "numeric" })}</p>
      <p className="text-sm text-muted-foreground">
        {usd(day.costUsd)} &middot; {day.calls} {day.calls === 1 ? "call" : "calls"}
      </p>
    </div>
  )
}

export function AiSpend() {
  const [days, setDays] = useState<number>(30)
  const [mounted, setMounted] = useState(false)
  const { usage, error, isLoading } = useAiUsage(days)

  // Recharts measures the DOM; render it only on the client.
  useEffect(() => setMounted(true), [])

  const trackingStartedInWindow =
    usage?.trackingSince && new Date(usage.trackingSince) > new Date(usage.since)

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-5 w-5" />
              Your AI Spend
            </CardTitle>
            <CardDescription>
              What your AI features cost on your Gemini key, from the tokens and searches each call used.
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            {RANGES.map((range) => (
              <Button
                key={range}
                variant="ghost"
                size="sm"
                className={cn("h-7 px-2 text-xs", days === range && "bg-muted")}
                onClick={() => setDays(range)}
              >
                {range}d
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="text-sm text-muted-foreground">Couldn&apos;t load AI usage.</p>
        ) : !mounted || isLoading || !usage ? (
          <div className="flex h-[200px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !usage.trackingSince ? (
          <p className="text-sm text-muted-foreground">
            No AI usage recorded yet. Costs appear here after your next link analysis or chat.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={`Last ${usage.days} days`} value={usd(usage.totalUsd)} />
              <Stat
                label="Per analyzed link"
                value={usage.costPerLinkUsd === null ? "—" : usd(usage.costPerLinkUsd)}
              />
              <Stat label="Per day, on average" value={usd(usage.totalUsd / usage.days)} />
            </div>

            <div className="h-[140px] w-full">
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={usage.daily} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) =>
                      days <= 30 ? formatDay(d, { day: "numeric" }) : formatDay(d, { month: "short", day: "numeric" })
                    }
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    minTickGap={days <= 30 ? 15 : 40}
                  />
                  <YAxis
                    tickFormatter={(v: number) => usd(v)}
                    tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                    axisLine={false}
                    tickLine={false}
                    width={52}
                  />
                  <Tooltip content={<DayTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
                  <Bar dataKey="costUsd" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={days <= 30 ? 20 : 10} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {usage.byKind.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1.5 font-medium">Feature</th>
                    <th className="py-1.5 text-right font-medium">Calls</th>
                    <th className="py-1.5 text-right font-medium">Tokens in / out</th>
                    <th className="py-1.5 text-right font-medium">Cost</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {usage.byKind
                    .slice()
                    .sort((a, b) => b.costUsd - a.costUsd)
                    .map((k) => (
                      <tr key={k.kind} className="border-b last:border-0">
                        <td className="py-1.5">
                          {KIND_LABELS[k.kind] ?? k.kind}
                          {k.searches > 0 && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              {k.searches} {k.searches === 1 ? "search" : "searches"}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 text-right">{k.calls}</td>
                        <td className="py-1.5 text-right">
                          {tokens(k.inputTokens)} / {tokens(k.outputTokens)}
                        </td>
                        <td className="py-1.5 text-right">{usd(k.costUsd)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}

            <div className="space-y-1 text-xs text-muted-foreground">
              {trackingStartedInWindow && (
                <p>
                  Tracking started {new Date(usage.trackingSince!).toLocaleDateString()}; earlier usage
                  isn&apos;t included.
                </p>
              )}
              {usage.unpricedCalls > 0 && (
                <p>
                  {usage.unpricedCalls} {usage.unpricedCalls === 1 ? "call" : "calls"} used a model without a
                  known price and {usage.unpricedCalls === 1 ? "isn't" : "aren't"} counted.
                </p>
              )}
              {(usage.search.inWindow > 0 || usage.search.thisMonth > 0) && usage.search.freePerMonth !== null && (
                <p>
                  Google searches this month: {usage.search.thisMonth.toLocaleString()} of{" "}
                  {usage.search.freePerMonth.toLocaleString()} free, then ${usage.search.usdPerThousand} per
                  1,000. A source lookup for a video runs a few. The free searches are shared with anything else on
                  the same Google billing account, which isn&apos;t counted here.
                </p>
              )}
              <p>
                Estimated at Gemini list prices; embeddings (well under 1% of cost) aren&apos;t included.
                Your Google billing is the source of truth.
              </p>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
