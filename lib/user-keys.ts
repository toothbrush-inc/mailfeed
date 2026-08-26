import { basePrisma } from "@/lib/prisma"
import { getUserDek } from "@/lib/crypto/dek"
import { encryptionConfigured } from "@/lib/crypto/kek"
import { KEY_PREFIX, encryptField, decryptField, isEncryptedField } from "@/lib/crypto/field-crypto"

// BYOK: each user's own LLM API keys, stored encrypted under their DEK in
// User.apiKeysEnc. The KEY_PREFIX keeps them out of the transparent decrypt
// path — a User row read returns ciphertext; only these functions (and never
// an API response) see the live values.
//
// Only Gemini keys for now: chat and embeddings are Gemini regardless of the
// selected analysis client, so one key unlocks every feature. The shape stays
// a map so more providers can be added later without a storage migration.

export interface AiKeys {
  gemini?: string
}

export type AiKeyName = keyof AiKeys

export const AI_KEY_NAMES: readonly AiKeyName[] = ["gemini"]

const ENV_VAR_BY_KEY: Record<AiKeyName, string> = {
  gemini: "GEMINI_API_KEY",
}

export function keyNameForEnvVar(envVar: string): AiKeyName | null {
  const match = (Object.entries(ENV_VAR_BY_KEY) as [AiKeyName, string][]).find(([, v]) => v === envVar)
  return match ? match[0] : null
}

/**
 * Whether the host's env keys may serve every user. Default true, which is
 * the self-hosted single-user behavior MailFeed always had. Hosted
 * multi-user instances set MAILFEED_SHARED_ENV_KEYS=false so each user's AI
 * usage runs on their own key — their billing, their rate limits, their
 * terms — and a missing key degrades features instead of spending the
 * host's money.
 */
export function sharedEnvKeysAllowed(): boolean {
  const flag = process.env.MAILFEED_SHARED_ENV_KEYS?.trim().toLowerCase()
  return !(flag === "0" || flag === "false" || flag === "no")
}

/** User key if set, else (when sharing is allowed) the host's env key. */
export function resolveApiKey(keys: AiKeys | undefined, envVar: string): string | undefined {
  const name = keyNameForEnvVar(envVar)
  const userKey = name ? keys?.[name] : undefined
  if (userKey) return userKey
  return sharedEnvKeysAllowed() ? process.env[envVar] || undefined : undefined
}

/** The Gemini key powering chat and embeddings, resolved for this user. */
export function resolveGeminiKey(keys: AiKeys | undefined): string | undefined {
  return resolveApiKey(keys, "GEMINI_API_KEY")
}

export async function getUserAiKeys(userId: string): Promise<AiKeys> {
  const user = await basePrisma.user.findUnique({
    where: { id: userId },
    select: { apiKeysEnc: true },
  })
  if (!user?.apiKeysEnc) return {}
  if (!isEncryptedField(user.apiKeysEnc, KEY_PREFIX)) {
    throw new Error("apiKeysEnc is not in the expected encrypted format")
  }
  const dek = await getUserDek(basePrisma, userId)
  const parsed = JSON.parse(decryptField(dek, user.apiKeysEnc, KEY_PREFIX)) as Record<string, unknown>
  const keys: AiKeys = {}
  for (const name of AI_KEY_NAMES) {
    if (typeof parsed[name] === "string" && parsed[name] !== "") keys[name] = parsed[name] as string
  }
  return keys
}

/**
 * Merges the given keys into the stored set. An empty string or null clears
 * that key. Returns the updated set.
 */
export async function setUserAiKeys(
  userId: string,
  updates: Partial<Record<AiKeyName, string | null>>
): Promise<AiKeys> {
  // API keys are never stored plaintext, so BYOK needs encryption on. The
  // self-hosted single-user setup doesn't need per-user keys — the env keys
  // are the operator's own.
  if (!encryptionConfigured()) {
    throw new Error(
      "Storing per-user API keys requires encryption at rest: set MAILFEED_KEK or KMS_KEY_NAME (see docs/encryption.md)."
    )
  }
  const current = await getUserAiKeys(userId)
  const next: AiKeys = { ...current }
  for (const name of AI_KEY_NAMES) {
    if (!(name in updates)) continue
    const value = updates[name]
    if (typeof value === "string" && value.trim() !== "") next[name] = value.trim()
    else delete next[name]
  }
  const dek = await getUserDek(basePrisma, userId)
  const apiKeysEnc =
    Object.keys(next).length > 0 ? encryptField(dek, userId, JSON.stringify(next), KEY_PREFIX) : null
  await basePrisma.user.update({ where: { id: userId }, data: { apiKeysEnc } })
  return next
}

/** Last-4 masks, safe for API responses: { gemini: "••••abcd" }. */
export function maskAiKeys(keys: AiKeys): Partial<Record<AiKeyName, string>> {
  const masked: Partial<Record<AiKeyName, string>> = {}
  for (const name of AI_KEY_NAMES) {
    const value = keys[name]
    if (value) masked[name] = `••••${value.slice(-4)}`
  }
  return masked
}
