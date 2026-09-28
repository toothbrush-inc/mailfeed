import { Suspense } from "react"
import { DigestContainer } from "@/components/digest/digest-container"

export default function DigestPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h2 className="text-2xl font-bold">Digest</h2>
        <p className="text-muted-foreground">
          The analysis of every link in your feed, and why the rest weren&apos;t analyzed.
        </p>
      </div>

      <Suspense fallback={null}>
        <DigestContainer />
      </Suspense>
    </div>
  )
}
