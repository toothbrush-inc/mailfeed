import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { resolveSettings, type UserSettings } from "@/lib/settings"
import { getRequiredApiKeyEnvVar } from "@/lib/ai-provider"
import {
  getUserAiKeys,
  setUserAiKeys,
  maskAiKeys,
  resolveApiKey,
  AI_KEY_NAMES,
  type AiKeyName,
} from "@/lib/user-keys"
import { encryptionConfigured } from "@/lib/crypto/kek"

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
  const aiKeys = await getUserAiKeys(session.user.id)

  return NextResponse.json({
    settings: resolved,
    aiKeyConfigured: !!resolveApiKey(aiKeys, envVar),
    requiredEnvVar: envVar,
    // Masked (last 4 only); live keys never leave the server.
    aiKeys: maskAiKeys(aiKeys),
    // BYOK storage needs encryption at rest; the UI hides the inputs otherwise.
    encryptionEnabled: encryptionConfigured(),
  })
}

export async function PATCH(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await request.json()
  // BYOK keys ride the same PATCH but are stored encrypted in their own
  // column, never inside the settings JSON (which GET returns wholesale).
  const { apiKeys: apiKeyUpdates, ...rest } = body as UserSettings & {
    apiKeys?: Partial<Record<AiKeyName, string | null>>
  }
  const partial: UserSettings = rest

  let storedKeys = await getUserAiKeys(session.user.id)
  if (apiKeyUpdates && typeof apiKeyUpdates === "object") {
    const sanitized: Partial<Record<AiKeyName, string | null>> = {}
    for (const name of AI_KEY_NAMES) {
      const value = apiKeyUpdates[name]
      if (typeof value === "string" || value === null) sanitized[name] = value
    }
    try {
      storedKeys = await setUserAiKeys(session.user.id, sanitized)
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Failed to store API keys" },
        { status: 400 }
      )
    }
  }

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
    // Left out before, which dropped these two groups on every save
    analysis: { ...current.analysis, ...partial.analysis },
    embeddings: { ...current.embeddings, ...partial.embeddings },
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
    aiKeyConfigured: !!resolveApiKey(storedKeys, envVar),
    requiredEnvVar: envVar,
    aiKeys: maskAiKeys(storedKeys),
    encryptionEnabled: encryptionConfigured(),
    queryChanged,
  })
}
