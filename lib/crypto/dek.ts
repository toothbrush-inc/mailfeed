import { mintDek } from "./field-crypto"
import { wrapDek, unwrapDek } from "./kek"

// Minimal slice of the (unextended) Prisma client that DEK management needs.
// Passed in rather than imported to avoid a module cycle with lib/prisma.ts.
export interface DekDb {
  user: {
    findUnique(args: {
      where: { id: string }
      select: { dekWrapped: true }
    }): Promise<{ dekWrapped: string | null } | null>
    updateMany(args: {
      where: { id: string; dekWrapped: null }
      data: { dekWrapped: string }
    }): Promise<{ count: number }>
  }
}

// Unwrapped DEKs, keyed per user. Keyed caching is safe in a shared process
// (unlike ambient per-user state); it saves a KMS round-trip per operation.
const dekCache = new Map<string, Buffer>()
const inFlight = new Map<string, Promise<Buffer>>()

export async function getUserDek(db: DekDb, userId: string): Promise<Buffer> {
  const cached = dekCache.get(userId)
  if (cached) return cached

  const pending = inFlight.get(userId)
  if (pending) return pending

  const promise = loadOrMintDek(db, userId)
    .then((dek) => {
      dekCache.set(userId, dek)
      return dek
    })
    .finally(() => {
      inFlight.delete(userId)
    })
  inFlight.set(userId, promise)
  return promise
}

async function loadOrMintDek(db: DekDb, userId: string): Promise<Buffer> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { dekWrapped: true },
  })
  if (!user) throw new Error(`Cannot load DEK: user ${userId} does not exist`)
  if (user.dekWrapped) return unwrapDek(user.dekWrapped)

  // Mint a DEK for a user that has none. The conditional update guards the
  // race where two requests mint concurrently: only the writer that finds
  // dekWrapped still null wins; the loser rereads and uses the stored one,
  // so no row is ever encrypted under a key that was never persisted.
  const dek = mintDek()
  const wrapped = await wrapDek(dek)
  const claimed = await db.user.updateMany({
    where: { id: userId, dekWrapped: null },
    data: { dekWrapped: wrapped },
  })
  if (claimed.count === 1) return dek

  const winner = await db.user.findUnique({
    where: { id: userId },
    select: { dekWrapped: true },
  })
  if (!winner?.dekWrapped) throw new Error(`DEK mint race for user ${userId} left no key`)
  return unwrapDek(winner.dekWrapped)
}

/** Test hook: clears the in-process DEK cache. */
export function clearDekCache(): void {
  dekCache.clear()
  inFlight.clear()
}
