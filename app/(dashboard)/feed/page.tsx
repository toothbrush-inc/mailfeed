import { Suspense } from "react"
import { FeedContainer } from "@/components/feed/feed-container"
import { FeedSkeleton } from "@/components/feed/feed-skeleton"
import { LinkTagFilter } from "@/components/feed/link-tag-filter"

export default function FeedPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Your Feed</h2>
        <p className="text-muted-foreground">
          Links extracted from emails you&apos;ve sent to yourself, analyzed and summarized.
        </p>
      </div>

      <Suspense fallback={null}>
        <LinkTagFilter />
      </Suspense>

      <Suspense fallback={<FeedSkeleton />}>
        <FeedContainer />
      </Suspense>
    </div>
  )
}
