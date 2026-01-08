import { Suspense } from "react"
import { EmailFeedContainer } from "@/components/feed/email-feed-container"
import { EmailFeedSkeleton } from "@/components/feed/email-feed-skeleton"
import { EmailTagFilter } from "@/components/feed/email-tag-filter"
import { EmailActivityChart } from "@/components/feed/email-activity-chart"

export default function EmailsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Emails</h2>
        <p className="text-muted-foreground">
          Emails you&apos;ve sent to yourself, grouped with their extracted links.
        </p>
      </div>

      <Suspense fallback={null}>
        <EmailActivityChart />
      </Suspense>

      <Suspense fallback={null}>
        <EmailTagFilter />
      </Suspense>

      <Suspense fallback={<EmailFeedSkeleton />}>
        <EmailFeedContainer />
      </Suspense>
    </div>
  )
}
