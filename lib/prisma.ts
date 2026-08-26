import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"
import { encryptionExtension, type EncryptionDb } from "@/lib/crypto/prisma-encryption"

function buildClients() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
  })
  const adapter = new PrismaPg(pool)
  // basePrisma bypasses field encryption. It exists for the crypto layer
  // itself (DEK bootstrap must read User.dekWrapped without recursing into
  // the extension) and for lib/user-keys.ts, which handles apiKeysEnc
  // explicitly. Application code imports `prisma`.
  const base = new PrismaClient({ adapter })
  const extended = base.$extends(encryptionExtension(base as unknown as EncryptionDb))
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
