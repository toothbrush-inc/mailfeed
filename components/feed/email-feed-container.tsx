"use client"

import { useEmails } from "@/hooks/use-emails"
import { EmailFeedItem } from "./email-feed-item"
import { EmailFeedSkeleton } from "./email-feed-skeleton"
import { Button } from "@/components/ui/button"

export function EmailFeedContainer() {
  const { emails, pagination, isLoading, error, mutate } = useEmails()

  if (isLoading) {
    return <EmailFeedSkeleton />
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950">
        <p className="text-red-600 dark:text-red-400">
          Failed to load emails. Please try again.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => window.location.reload()}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (emails.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-12 text-center dark:bg-zinc-900">
        <div className="mx-auto max-w-md">
          <h3 className="text-lg font-semibold">No emails yet</h3>
          <p className="mt-2 text-muted-foreground">
            Click the &quot;Sync Emails&quot; button to fetch emails you&apos;ve sent to yourself.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {emails.map((email) => (
        <EmailFeedItem key={email.id} email={email} onIngestComplete={mutate} />
      ))}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-4">
          <p className="text-sm text-muted-foreground">
            Showing {emails.length} of {pagination.total} emails
          </p>
        </div>
      )}
    </div>
  )
}
