import { GoogleAuth } from "google-auth-library"
import {
  KMS_WRAP_PREFIX,
  LOCAL_WRAP_PREFIX,
  wrapKeyLocal,
  unwrapKeyLocal,
} from "./field-crypto"

// The KEK (key-encryption key) wraps per-user DEKs. Two providers:
//
// - Cloud KMS (production): set KMS_KEY_NAME to the full resource name,
//   projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>. Auth is ADC —
//   on GCE the metadata server supplies the VM service account, which needs
//   roles/cloudkms.cryptoKeyEncrypterDecrypter on the key. The KEK never
//   exists outside KMS; every unwrap is IAM-gated and audit-logged.
//
// - Local (dev): set MAILFEED_KEK to a base64 32-byte key
//   (openssl rand -base64 32).
//
// Both may be configured at once (e.g. migrating): wrapping uses KMS when
// available; unwrapping dispatches on the stored prefix.
//
// If neither is set, encryption is OFF and MailFeed stores plaintext exactly
// as it always has — the self-hosted quick start keeps working unchanged.
// Hosted deployments set MAILFEED_REQUIRE_ENCRYPTION=true so a missing key
// is a hard error instead of a silent downgrade.

const KMS_SCOPE = "https://www.googleapis.com/auth/cloudkms"

let googleAuth: GoogleAuth | undefined

function kmsKeyName(): string | undefined {
  const name = process.env.KMS_KEY_NAME?.trim()
  return name ? name : undefined
}

function localKek(): Buffer | undefined {
  const raw = process.env.MAILFEED_KEK?.trim()
  if (!raw) return undefined
  const kek = Buffer.from(raw, "base64")
  if (kek.length !== 32) {
    throw new Error("MAILFEED_KEK must be 32 bytes of base64 (openssl rand -base64 32)")
  }
  return kek
}

async function kmsCall(action: "encrypt" | "decrypt", body: object): Promise<string> {
  const key = kmsKeyName()
  if (!key) throw new Error("KMS_KEY_NAME is not configured")
  googleAuth ??= new GoogleAuth({ scopes: [KMS_SCOPE] })
  const client = await googleAuth.getClient()
  const token = await client.getAccessToken()
  if (!token.token) throw new Error("Cloud KMS: could not obtain an access token (is ADC available?)")
  const res = await fetch(`https://cloudkms.googleapis.com/v1/${key}:${action}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token.token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => "")
    throw new Error(`Cloud KMS ${action} failed: ${res.status} ${detail.slice(0, 300)}`)
  }
  const json = (await res.json()) as { ciphertext?: string; plaintext?: string }
  const value = action === "encrypt" ? json.ciphertext : json.plaintext
  if (!value) throw new Error(`Cloud KMS ${action}: response missing payload`)
  return value
}

/** True when a KEK source (Cloud KMS or MAILFEED_KEK) is configured. */
export function encryptionConfigured(): boolean {
  return !!kmsKeyName() || !!localKek()
}

/** True when the deployment demands encryption (hosted instances). */
export function encryptionRequired(): boolean {
  const flag = process.env.MAILFEED_REQUIRE_ENCRYPTION?.trim().toLowerCase()
  return flag === "1" || flag === "true" || flag === "yes"
}

export async function wrapDek(dek: Buffer): Promise<string> {
  if (kmsKeyName()) {
    const ciphertext = await kmsCall("encrypt", { plaintext: dek.toString("base64") })
    return `${KMS_WRAP_PREFIX}${ciphertext}`
  }
  const kek = localKek()
  if (kek) return wrapKeyLocal(kek, dek)
  throw new Error(
    "Encryption at rest is not configured: set KMS_KEY_NAME (Cloud KMS) or MAILFEED_KEK."
  )
}

export async function unwrapDek(wrapped: string): Promise<Buffer> {
  if (wrapped.startsWith(KMS_WRAP_PREFIX)) {
    const plaintext = await kmsCall("decrypt", { ciphertext: wrapped.slice(KMS_WRAP_PREFIX.length) })
    return Buffer.from(plaintext, "base64")
  }
  if (wrapped.startsWith(LOCAL_WRAP_PREFIX)) {
    const kek = localKek()
    if (!kek) throw new Error("Found a locally wrapped DEK but MAILFEED_KEK is not set")
    return unwrapKeyLocal(kek, wrapped)
  }
  throw new Error("User DEK is wrapped in an unrecognized format")
}
