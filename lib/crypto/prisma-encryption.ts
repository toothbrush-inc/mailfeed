import { Prisma } from "@prisma/client"
import { getUserDek, type DekDb } from "./dek"
import { encryptionConfigured, encryptionRequired } from "./kek"
import {
  FIELD_PREFIX,
  encryptField,
  decryptField,
  isEncryptedField,
  keyIdOf,
} from "./field-crypto"

// The columns encrypted at rest, per model. Everything else — link/article
// content fetched from public URLs, AI outputs derived from it, embedding
// vectors (which must stay plaintext to be searchable) — is deliberately not
// listed. The keyId inside each ciphertext is the owning userId, which makes
// values self-describing: reads decrypt without knowing which query shape
// (include, select, raw SQL) produced them.
export const ENCRYPTED_FIELDS: Record<string, readonly string[]> = {
  Email: ["subject", "snippet", "rawContent"],
  Account: ["access_token", "refresh_token", "id_token"],
}

const WRITE_OPS = new Set([
  "create",
  "update",
  "upsert",
  "createMany",
  "createManyAndReturn",
  "updateMany",
  "updateManyAndReturn",
])

export interface EncryptionDb extends DekDb {
  email: { findFirst(args: object): Promise<{ userId: string } | null> }
  account: { findFirst(args: object): Promise<{ userId: string } | null> }
}

export function encryptionExtension(db: EncryptionDb) {
  return Prisma.defineExtension({
    name: "field-encryption",
    query: {
      $allOperations: async ({ model, operation, args, query }) => {
        if (model && ENCRYPTED_FIELDS[model] && WRITE_OPS.has(operation)) {
          await encryptWriteArgs(db, model, operation, args as Record<string, unknown>)
        }
        const result = await query(args)
        return decryptDeepWith(db, result)
      },
    },
  })
}

async function encryptWriteArgs(
  db: EncryptionDb,
  model: string,
  operation: string,
  args: Record<string, unknown>
): Promise<void> {
  const fields = ENCRYPTED_FIELDS[model]

  if (operation === "create") {
    await encryptData(db, model, fields, args.data as Record<string, unknown>, null, args)
    return
  }
  if (operation === "createMany" || operation === "createManyAndReturn") {
    const data = (args.data ?? []) as Record<string, unknown> | Record<string, unknown>[]
    const rows = Array.isArray(data) ? data : [data]
    for (const row of rows) await encryptData(db, model, fields, row, null, args)
    return
  }
  if (operation === "update") {
    await encryptData(db, model, fields, args.data as Record<string, unknown>, args.where ?? null, args)
    return
  }
  if (operation === "upsert") {
    const create = args.create as Record<string, unknown>
    const ownerId = ownerFromData(create)
    await encryptData(db, model, fields, create, null, args)
    await encryptData(db, model, fields, args.update as Record<string, unknown>, null, args, ownerId)
    return
  }
  // updateMany over encrypted fields would need one DEK per targeted row;
  // no code path does this. Fail loudly rather than write plaintext.
  const data = args.data as Record<string, unknown> | undefined
  if (data && fields.some((f) => data[f] !== undefined && data[f] !== null)) {
    throw new Error(`${operation} on ${model} cannot write encrypted fields (${fields.join(", ")})`)
  }
}

let warnedPlaintext = false

async function encryptData(
  db: EncryptionDb,
  model: string,
  fields: readonly string[],
  data: Record<string, unknown> | undefined,
  where: unknown,
  args: Record<string, unknown>,
  knownOwnerId?: string | null
): Promise<void> {
  if (!data) return
  const touched = fields.filter((f) => typeof data[f] === "string")
  if (touched.length === 0) return

  // Without a configured KEK the self-hosted default applies: store
  // plaintext, as MailFeed always has. Hosted instances set
  // MAILFEED_REQUIRE_ENCRYPTION=true to turn this into a hard error.
  if (!encryptionConfigured()) {
    if (encryptionRequired()) {
      throw new Error(
        "MAILFEED_REQUIRE_ENCRYPTION is set but no KEK is configured (KMS_KEY_NAME or MAILFEED_KEK)"
      )
    }
    if (!warnedPlaintext) {
      warnedPlaintext = true
      console.warn(
        "[Encryption] No KMS_KEY_NAME or MAILFEED_KEK set — storing data unencrypted. " +
          "Set one to enable encryption at rest (see docs/encryption.md)."
      )
    }
    return
  }

  let ownerId = knownOwnerId ?? ownerFromData(data)
  if (!ownerId && where) ownerId = await ownerFromRow(db, model, where)
  if (!ownerId) {
    throw new Error(
      `Cannot encrypt ${model}.${touched.join("/")}: no owning userId in ${JSON.stringify(Object.keys(args))}`
    )
  }

  const dek = await getUserDek(db, ownerId)
  for (const field of touched) {
    // Unconditionally: reads always return plaintext, so writes are always
    // plaintext. Skipping values that merely look encrypted would let a
    // crafted email subject (attacker-controlled input) bypass encryption.
    data[field] = encryptField(dek, ownerId, data[field] as string)
  }
}

function ownerFromData(data: Record<string, unknown> | undefined): string | null {
  if (!data) return null
  if (typeof data.userId === "string") return data.userId
  const user = data.user as { connect?: { id?: unknown } } | undefined
  return typeof user?.connect?.id === "string" ? user.connect.id : null
}

async function ownerFromRow(db: EncryptionDb, model: string, where: unknown): Promise<string | null> {
  const delegate = model === "Email" ? db.email : model === "Account" ? db.account : null
  if (!delegate) return null
  const row = await delegate.findFirst({ where, select: { userId: true } })
  return row?.userId ?? null
}

/**
 * Recursively decrypts every FIELD_PREFIX string in a query result. Applied
 * to all operations (including raw SQL), so nested includes and hand-written
 * SELECTs come back plaintext without per-call-site work. Values that fail
 * to decrypt throw — a wrong or missing KEK must not read as empty data.
 */
async function decryptDeepWith<T>(db: DekDb, value: T): Promise<T> {
  if (value === null || value === undefined) return value

  if (typeof value === "string") {
    if (!isEncryptedField(value)) return value
    // A prefixed string that doesn't parse as ciphertext is data that merely
    // resembles it (e.g. pasted into a settings field) — pass it through.
    // Structurally valid ciphertext that fails GCM auth still throws, so a
    // wrong or missing KEK stays loud.
    const userId = keyIdOf(value)
    if (!userId) return value
    const dek = await getUserDek(db, userId)
    return decryptField(dek, value) as unknown as T
  }

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) value[i] = await decryptDeepWith(db, value[i])
    return value
  }

  if (typeof value === "object") {
    if (value instanceof Date || Buffer.isBuffer(value)) return value
    const record = value as Record<string, unknown>
    for (const key of Object.keys(record)) {
      const child = record[key]
      // Fast path: only recurse where ciphertext can hide.
      if (child !== null && (typeof child === "object" || isEncryptedField(child))) {
        record[key] = await decryptDeepWith(db, child)
      }
    }
    return value
  }

  return value
}

/** Explicit decryption for results that bypass the extension. Idempotent. */
export function makeDecryptDeep(db: DekDb): <T>(value: T) => Promise<T> {
  return (value) => decryptDeepWith(db, value)
}

export { FIELD_PREFIX }
