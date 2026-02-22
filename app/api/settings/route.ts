import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { resolveSettings, type UserSettings } from "@/lib/settings"
import { getRequiredApiKeyEnvVar } from "@/lib/ai-provider"

export async function GET() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { settings: true },
  })

  const resolved = resolveSettings(user?.settings as UserSettings | null)
  const envVar = getRequiredApiKeyEnvVar(resolved.ai.bamlClient)

  return NextResponse.json({
    settings: resolved,
    aiKeyConfigured: !!process.env[envVar],
    requiredEnvVar: envVar,
  })
}

export async function PATCH(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  const partial: UserSettings = body

  // Load current raw settings and deep-merge
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { settings: true, syncQuery: true },
  })

  const current = (user?.settings as UserSettings) || {}

  const merged: UserSettings = {
    ai: { ...current.ai, ...partial.ai },
    email: { ...current.email, ...partial.email },
    fetching: { ...current.fetching, ...partial.fetching },
    feed: { ...current.feed, ...partial.feed },
    sync: { ...current.sync, ...partial.sync },
  }

  // Detect if the email query changed — invalidate sync state
  const resolvedOld = resolveSettings(current)
  const resolvedNew = resolveSettings(merged)
  const queryChanged = partial.email?.query !== undefined && resolvedNew.email.query !== resolvedOld.email.query

  const updateData: Record<string, unknown> = {
    settings: JSON.parse(JSON.stringify(merged)),
  }
  if (queryChanged) {
    updateData.syncQuery = null
    updateData.syncNewestEmailDate = null
    updateData.syncOldestEmailDate = null
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: updateData,
  })

  const envVar = getRequiredApiKeyEnvVar(resolvedNew.ai.bamlClient)

  return NextResponse.json({
    settings: resolvedNew,
    aiKeyConfigured: !!process.env[envVar],
    requiredEnvVar: envVar,
    queryChanged,
  })
}
