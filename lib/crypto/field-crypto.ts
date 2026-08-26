import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

// Encrypted values are self-describing strings:
//
//   <prefix><keyId>.<iv base64url>.<ciphertext+tag base64url>
//
// The prefix decides who may decrypt transparently. FIELD_PREFIX marks
// content fields (email subject/snippet/body, OAuth tokens): the Prisma
// read extension decrypts these wherever they appear in a result. KEY_PREFIX
// marks the user's stored LLM API keys: the extension deliberately skips
// them, so reading a User row can never return live keys — they are only
// decrypted explicitly via lib/user-keys.ts.
export const FIELD_PREFIX = "enc.v1."
export const KEY_PREFIX = "enck.v1."

// DEK-wrapping formats (User.dekWrapped). "kms.v1." holds Cloud KMS
// ciphertext; "local.v1." is AES-256-GCM under the MAILFEED_KEK env key.
export const KMS_WRAP_PREFIX = "kms.v1."
export const LOCAL_WRAP_PREFIX = "local.v1."

const IV_BYTES = 12
const TAG_BYTES = 16

function b64url(buf: Buffer): string {
  return buf.toString("base64url")
}

export function encryptField(
  dek: Buffer,
  keyId: string,
  plaintext: string,
  prefix: string = FIELD_PREFIX
): string {
  if (keyId.includes(".")) {
    throw new Error(`encryptField: keyId must not contain "." (got ${keyId})`)
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", dek, iv)
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final(), cipher.getAuthTag()])
  return `${prefix}${keyId}.${b64url(iv)}.${b64url(ct)}`
}

export function decryptField(dek: Buffer, value: string, prefix: string = FIELD_PREFIX): string {
  const parsed = parseEncrypted(value, prefix)
  if (!parsed) {
    throw new Error("decryptField: value is not in the expected encrypted format")
  }
  const { iv, payload } = parsed
  const ct = payload.subarray(0, payload.length - TAG_BYTES)
  const tag = payload.subarray(payload.length - TAG_BYTES)
  const decipher = createDecipheriv("aes-256-gcm", dek, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8")
}

export function isEncryptedField(value: unknown, prefix: string = FIELD_PREFIX): value is string {
  return typeof value === "string" && value.startsWith(prefix)
}

/** Extracts the keyId (the owning userId) from an encrypted value, or null. */
export function keyIdOf(value: string, prefix: string = FIELD_PREFIX): string | null {
  const parsed = parseEncrypted(value, prefix)
  return parsed?.keyId ?? null
}

function parseEncrypted(
  value: string,
  prefix: string
): { keyId: string; iv: Buffer; payload: Buffer } | null {
  if (!value.startsWith(prefix)) return null
  const parts = value.slice(prefix.length).split(".")
  if (parts.length !== 3) return null
  const [keyId, ivB64, payloadB64] = parts
  const iv = Buffer.from(ivB64, "base64url")
  const payload = Buffer.from(payloadB64, "base64url")
  if (keyId === "" || iv.length !== IV_BYTES || payload.length <= TAG_BYTES) return null
  return { keyId, iv, payload }
}

export function mintDek(): Buffer {
  return randomBytes(32)
}

export function wrapKeyLocal(kek: Buffer, dek: Buffer): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv("aes-256-gcm", kek, iv)
  const ct = Buffer.concat([cipher.update(dek), cipher.final(), cipher.getAuthTag()])
  return `${LOCAL_WRAP_PREFIX}${b64url(iv)}.${b64url(ct)}`
}

export function unwrapKeyLocal(kek: Buffer, wrapped: string): Buffer {
  const parts = wrapped.slice(LOCAL_WRAP_PREFIX.length).split(".")
  if (!wrapped.startsWith(LOCAL_WRAP_PREFIX) || parts.length !== 2) {
    throw new Error("unwrapKeyLocal: not a local-wrapped key")
  }
  const iv = Buffer.from(parts[0], "base64url")
  const payload = Buffer.from(parts[1], "base64url")
  const ct = payload.subarray(0, payload.length - TAG_BYTES)
  const tag = payload.subarray(payload.length - TAG_BYTES)
  const decipher = createDecipheriv("aes-256-gcm", kek, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()])
}
