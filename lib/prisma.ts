import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { encryptionExtension, type EncryptionDb } from "@/lib/crypto/prisma-encryption"
import { tenantIsolationExtension } from "@/lib/tenant-guard"

function buildClients() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    // Hosted Postgres (and anything behind NAT/PgBouncer) will drop idle
    // clients. Without an error listener, node-pg treats that as an uncaught
    // exception and kills the process — nginx then reports a flaky 502 on
    // whichever request is in flight, and the retry succeeds on a new connection.
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  })
  pool.on("error", (error) => {
    console.error("[Prisma] Idle client error (connection recycled):", error)
  })
  const adapter = new PrismaPg(pool)
  // basePrisma bypasses field encryption. It exists for the crypto layer
  // itself (DEK bootstrap must read User.dekWrapped without recursing into
  // the extension) and for lib/user-keys.ts, which handles apiKeysEnc
  // explicitly. Application code imports `prisma`.
  const base = new PrismaClient({ adapter })
  const extended = base
    .$extends(encryptionExtension(base as unknown as EncryptionDb))
    .$extends(tenantIsolationExtension())
  return { pool, base, extended }
}

const globalForPrisma = globalThis as unknown as {
  prismaClients: ReturnType<typeof buildClients> | undefined
}

if (!globalForPrisma.prismaClients) {
  console.log("[Prisma] Creating new PrismaClient...")
  globalForPrisma.prismaClients = buildClients()
}

export const basePrisma = globalForPrisma.prismaClients.base
export const prisma = globalForPrisma.prismaClients.extended
