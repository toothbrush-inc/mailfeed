import { Suspense } from "react"
import { MediaContainer } from "@/components/media/media-container"

export default function MediaPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Media</h2>
        <p className="text-muted-foreground">
          Every video, podcast, book and game among your links, including the ones shared inside posts.
        </p>
      </div>

      <Suspense fallback={null}>
        <MediaContainer />
      </Suspense>
    </div>
  )
}
