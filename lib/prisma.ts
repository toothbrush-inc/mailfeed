import { PrismaClient } from "@prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { Pool } from "pg"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

function createPrismaClient() {
  // Reuse pool if it exists
  if (!globalForPrisma.pool) {
    globalForPrisma.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
    })
  }

  const adapter = new PrismaPg(globalForPrisma.pool)
  return new PrismaClient({ adapter })
}

// Only create a new client if one doesn't exist in the global cache
if (!globalForPrisma.prisma) {
  console.log("[Prisma] Creating new PrismaClient...")
  globalForPrisma.prisma = createPrismaClient()
}

export const prisma = globalForPrisma.prisma
