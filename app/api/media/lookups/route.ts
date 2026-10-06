import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { runPendingLookups } from "@/lib/media-lookup"

// POST /api/media/lookups - Run video lookups for posts waiting for one.
// Each lookup takes around half a minute, so a call does two: repeat while
// `remaining` is above zero and the call processed something.
export async function POST() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const result = await runPendingLookups(session.user.id, { limit: 2, budgetMs: 20_000 })

  if (result.unavailable) {
    return NextResponse.json({ ...result, error: result.unavailable }, { status: 409 })
  }
  return NextResponse.json(result)
}
