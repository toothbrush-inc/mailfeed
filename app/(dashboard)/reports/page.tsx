"use client"

import { useState } from "react"
import useSWR from "swr"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, RefreshCw, Loader2, ChevronLeft, ChevronRight, AlertTriangle, Archive } from "lucide-react"

interface Report {
  id: string
  linkId: string
  userId: string
  reason: string | null
  createdAt: string
  link: {
    id: string
    url: string
    finalUrl: string | null
    domain: string | null
    finalDomain: string | null
    title: string | null
    fetchStatus: string
    fetchError: string | null
    contentSource: string | null
    isPaywalled: boolean
    paywallType: string | null
    createdAt: string
  }
  user: {
    id: string
    name: string | null
    email: string | null
  }
}

interface ReportsResponse {
  reports: Report[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
  }
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
}

function getStatusColor(status: string): string {
  switch (status) {
    case "FETCHED":
    case "COMPLETED":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
    case "FAILED":
      return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
    case "PAYWALL_DETECTED":
      return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
    case "PENDING":
    case "FETCHING":
    case "ANALYZING":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200"
    default:
      return "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
  }
}

export default function ReportsPage() {
  const [page, setPage] = useState(1)
  const [refetchingId, setRefetchingId] = useState<string | null>(null)
  const [archivingId, setArchivingId] = useState<string | null>(null)

  const { data, isLoading, mutate } = useSWR<ReportsResponse>(
    `/api/reports?page=${page}&limit=20`,
    fetcher
  )

  const handleRefetch = async (linkId: string) => {
    setRefetchingId(linkId)
    try {
      const response = await fetch(`/api/links/${linkId}/refetch`, {
        method: "POST",
      })
      if (response.ok) {
        mutate()
      }
    } catch (error) {
      console.error("Failed to refetch:", error)
    } finally {
      setRefetchingId(null)
    }
  }

  const handleFetchArchive = async (linkId: string) => {
    setArchivingId(linkId)
    try {
      const response = await fetch(`/api/links/${linkId}/wayback`, {
        method: "POST",
      })
      if (response.ok) {
        mutate()
      }
    } catch (error) {
      console.error("Failed to fetch from archive:", error)
    } finally {
      setArchivingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h2 className="text-2xl font-bold">Reported Links</h2>
          <p className="text-muted-foreground">
            Links reported by users as having issues with content fetching.
          </p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    )
  }

  const reports = data?.reports || []
  const pagination = data?.pagination

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Reported Links</h2>
        <p className="text-muted-foreground">
          Links reported by users as having issues with content fetching.
          {pagination && pagination.total > 0 && (
            <span className="ml-2 font-medium">{pagination.total} total reports</span>
          )}
        </p>
      </div>

      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No reported links yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {reports.map((report) => (
            <Card key={report.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-base font-medium truncate">
                      {report.link.title || report.link.finalUrl || report.link.url}
                    </CardTitle>
                    <CardDescription className="mt-1 space-y-1">
                      <span className="block truncate text-xs">
                        {report.link.finalUrl || report.link.url}
                      </span>
                      <span className="block text-xs">
                        Reported by {report.user.name || report.user.email} on {formatDate(report.createdAt)}
                      </span>
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge className={getStatusColor(report.link.fetchStatus)}>
                      {report.link.fetchStatus.replace("_", " ")}
                    </Badge>
                    {report.link.isPaywalled && (
                      <Badge variant="outline" className="text-amber-600 border-amber-600">
                        {report.link.paywallType || "Paywall"}
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  {/* Error message if any */}
                  {report.link.fetchError && (
                    <div className="flex items-start gap-2 rounded-md bg-red-50 dark:bg-red-950 p-3 text-sm">
                      <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                      <span className="text-red-700 dark:text-red-300">{report.link.fetchError}</span>
                    </div>
                  )}

                  {/* Report reason if any */}
                  {report.reason && (
                    <div className="text-sm text-muted-foreground">
                      <span className="font-medium">Reason:</span> {report.reason}
                    </div>
                  )}

                  {/* Meta info */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>Domain: {report.link.finalDomain || report.link.domain || "unknown"}</span>
                    {report.link.contentSource && (
                      <span>Source: {report.link.contentSource}</span>
                    )}
                    <span>Link created: {formatDate(report.link.createdAt)}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRefetch(report.link.id)}
                      disabled={refetchingId === report.link.id}
                    >
                      {refetchingId === report.link.id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Refetch
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleFetchArchive(report.link.id)}
                      disabled={archivingId === report.link.id}
                    >
                      {archivingId === report.link.id ? (
                        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Archive className="mr-1.5 h-3.5 w-3.5" />
                      )}
                      Try Archive
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <a
                        href={report.link.finalUrl || report.link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                        Open URL
                      </a>
                    </Button>
                    <Button variant="ghost" size="sm" asChild>
                      <a href={`/feed?search=${encodeURIComponent(report.link.url)}`}>
                        View in Feed
                      </a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {/* Pagination */}
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-sm text-muted-foreground">
                Showing {(pagination.page - 1) * pagination.limit + 1} -{" "}
                {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page === pagination.totalPages}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
