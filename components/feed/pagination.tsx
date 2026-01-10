"use client"

import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight } from "lucide-react"

interface PaginationProps {
  page: number
  totalPages: number
  total: number
  limit: number
  onPageChange: (page: number) => void
  compact?: boolean
}

export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onPageChange,
  compact = false,
}: PaginationProps) {
  // Calculate the range of results being shown
  const start = (page - 1) * limit + 1
  const end = Math.min(page * limit, total)
  const hasMultiplePages = totalPages > 1

  if (compact) {
    return (
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {hasMultiplePages ? (
            <>Showing {start}–{end} of {total}</>
          ) : (
            <>{total} {total === 1 ? "result" : "results"}</>
          )}
        </span>
        {hasMultiplePages && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(page - 1)}
              disabled={page <= 1}
              className="h-7 px-2"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages}
              className="h-7 px-2"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    )
  }

  // Don't show bottom pagination if only one page
  if (!hasMultiplePages) return null

  return (
    <div className="flex items-center justify-between border-t pt-4 mt-4">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft className="h-4 w-4 mr-1" />
        Previous
      </Button>

      <p className="text-sm text-muted-foreground">
        Showing {start}–{end} of {total}
      </p>

      <Button
        variant="outline"
        size="sm"
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages}
      >
        Next
        <ChevronRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  )
}
