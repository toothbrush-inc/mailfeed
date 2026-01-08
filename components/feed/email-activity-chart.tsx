"use client"

import { useState } from "react"
import { useEmailStats } from "@/hooks/use-email-stats"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

const TIME_RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "1y", days: 365 },
  { label: "All", days: 0 },
] as const

// Format date as "Jan 15" or "Jan 15, 2024" for tooltip
function formatDate(dateString: string, includeYear = false): string {
  const date = new Date(dateString + "T00:00:00")
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    ...(includeYear && { year: "numeric" }),
  }
  return date.toLocaleDateString("en-US", options)
}

// Format x-axis tick based on time range
function formatXAxisTick(dateString: string, days: number): string {
  const date = new Date(dateString + "T00:00:00")
  if (days <= 30) {
    // Show day number for short ranges
    return date.getDate().toString()
  } else if (days <= 90) {
    // Show "Jan 15" for medium ranges
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  } else {
    // Show "Jan" or "Jan '24" for long ranges
    const now = new Date()
    const sameYear = date.getFullYear() === now.getFullYear()
    if (sameYear) {
      return date.toLocaleDateString("en-US", { month: "short" })
    }
    return date.toLocaleDateString("en-US", { month: "short", year: "2-digit" })
  }
}

// Custom tooltip component
interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
  days?: number
}

function CustomTooltip({ active, payload, label, days = 30 }: CustomTooltipProps) {
  if (active && payload && payload.length && label) {
    const includeYear = days > 365 || days === 0
    return (
      <div className="rounded-lg border bg-background p-2 shadow-sm">
        <p className="text-sm font-medium">{formatDate(label, includeYear)}</p>
        <p className="text-sm text-muted-foreground">
          {payload[0].value} {payload[0].value === 1 ? "email" : "emails"}
        </p>
      </div>
    )
  }
  return null
}

export function EmailActivityChart() {
  const [days, setDays] = useState(30)
  const { stats, isLoading, error } = useEmailStats(days)

  if (isLoading) {
    return (
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">Email Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[120px] items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error || !stats) {
    return null // Silently fail - chart is not critical
  }

  const periodTotal = stats.periodTotal

  if (periodTotal === 0 && stats.total === 0) {
    return null // Don't show chart if no data at all
  }

  // Format period label
  const periodLabel = days === 0 ? "all time" : `last ${TIME_RANGES.find(r => r.days === days)?.label || days + "d"}`

  // Calculate appropriate tick interval based on data length
  const tickInterval = stats.daily.length > 60 ? Math.floor(stats.daily.length / 10) : "preserveStartEnd"

  return (
    <Card className="mb-6">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base font-medium">Email Activity</CardTitle>
            <span className="text-sm text-muted-foreground">
              {periodTotal} emails ({periodLabel})
            </span>
          </div>
          <div className="flex items-center gap-1">
            {TIME_RANGES.map((range) => (
              <Button
                key={range.days}
                variant="ghost"
                size="sm"
                className={cn(
                  "h-7 px-2 text-xs",
                  days === range.days && "bg-muted"
                )}
                onClick={() => setDays(range.days)}
              >
                {range.label}
              </Button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-[120px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={stats.daily}
              margin={{ top: 5, right: 10, left: 0, bottom: 0 }}
            >
              <XAxis
                dataKey="date"
                tickFormatter={(date) => formatXAxisTick(date, days)}
                tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                interval={tickInterval}
                minTickGap={days <= 30 ? 15 : 40}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={35}
              />
              <Tooltip
                content={<CustomTooltip days={days} />}
                cursor={{ fill: "hsl(var(--muted))", opacity: 0.3 }}
              />
              <Bar
                dataKey="count"
                fill="hsl(var(--primary))"
                radius={[2, 2, 0, 0]}
                maxBarSize={days <= 30 ? 20 : 12}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
