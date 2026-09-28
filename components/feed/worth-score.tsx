import { cn } from "@/lib/utils"

interface WorthScoreProps {
  score: number | null | undefined
  reason?: string | null
  className?: string
}

/** "Worth reading" score as five dots; the reason shows on hover. Unscored links render nothing. */
export function WorthScore({ score, reason, className }: WorthScoreProps) {
  if (score == null || score < 1 || score > 5) return null
  const value = Math.round(score)
  const label = `Worth reading: ${value}/5${reason ? ` – ${reason}` : ""}`

  return (
    <span
      className={cn("inline-flex items-center gap-0.5 whitespace-nowrap", className)}
      title={label}
      aria-label={label}
      role="img"
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i <= value ? "bg-amber-500 dark:bg-amber-400" : "bg-muted-foreground/25"
          )}
        />
      ))}
    </span>
  )
}
