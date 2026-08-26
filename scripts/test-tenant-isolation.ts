/**
 * Tenant isolation: Bob must not see Alice's mail through the same queries
 * the API routes use. Needs a throwaway database:
 *
 *   docker run -d --name mailfeed-iso-test -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=mailfeed_test -p 5599:5432 pgvector/pgvector:pg16
 *   DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
 *     npx prisma migrate deploy
 *   DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
 *     npx tsx scripts/test-tenant-isolation.ts
 *   docker rm -f mailfeed-iso-test
 */
import { prisma, basePrisma } from "../lib/prisma"
import { findEmailIdsMatchingText, textSearchEmails } from "../lib/email-search"
import { searchSimilarContent, textSearchLinks } from "../lib/vector-search"
import { EMBEDDING_DIMENSIONS, formatEmbeddingForPgVector } from "../lib/embeddings"

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? "")
  }
}

async function expectThrow(name: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    check(name, false, "expected throw")
  } catch {
    check(name, true)
  }
}

function unitEmbedding(fill = 0, spike = 1): number[] {
  const vec = Array(EMBEDDING_DIMENSIONS).fill(fill)
  vec[0] = spike
  return vec
}

async function main() {
  await basePrisma.linkReport.deleteMany({})
  await basePrisma.fetchAttempt.deleteMany({})
  await basePrisma.link.deleteMany({})
  await basePrisma.email.deleteMany({})
  await basePrisma.account.deleteMany({})
  await basePrisma.session.deleteMany({})
  await basePrisma.user.deleteMany({})

  const alice = await prisma.user.create({ data: { email: "alice-iso@example.com" } })
  const bob = await prisma.user.create({ data: { email: "bob-iso@example.com" } })

  const aliceEmail = await prisma.email.create({
    data: {
      userId: alice.id,
      gmailId: "gm-shared-looking",
      subject: "Alice secret subject",
      snippet: "Alice secret snippet",
      rawContent: "Alice secret body about project zebra",
      receivedAt: new Date("2026-01-01T00:00:00Z"),
    },
  })
  const bobEmail = await prisma.email.create({
    data: {
      userId: bob.id,
      gmailId: "gm-bob",
      subject: "Bob grocery list",
      snippet: "milk",
      rawContent: "Bob body",
      receivedAt: new Date("2026-01-02T00:00:00Z"),
    },
  })

  const aliceLink = await prisma.link.create({
    data: {
      userId: alice.id,
      emailId: aliceEmail.id,
      url: "https://alice.example/secret",
      urlHash: "alice-hash",
      title: "Alice secret article",
      aiSummary: "zebra briefing",
      contentText: "classified zebra notes",
    },
  })
  const bobLink = await prisma.link.create({
    data: {
      userId: bob.id,
      emailId: bobEmail.id,
      url: "https://bob.example/public",
      urlHash: "bob-hash",
      title: "Bob public article",
      aiSummary: "groceries",
      contentText: "milk and eggs",
    },
  })

  // --- GET /api/emails ---
  const bobList = await prisma.email.findMany({
    where: { userId: bob.id },
    include: { links: { where: { userId: bob.id } } },
  })
  check(
    "GET /api/emails as Bob does not include Alice",
    bobList.length === 1 && bobList[0].id === bobEmail.id && !bobList[0].rawContent?.includes("zebra")
  )

  const bobSearchIds = await findEmailIdsMatchingText(bob.id, "zebra")
  check("email search as Bob misses Alice's body", bobSearchIds.length === 0)
  const aliceSearchIds = await findEmailIdsMatchingText(alice.id, "zebra")
  check("email search as Alice hits her body", aliceSearchIds.length === 1 && aliceSearchIds[0] === aliceEmail.id)

  // --- POST /api/emails/[id]/ingest ---
  const bobIngest = await prisma.email.findFirst({
    where: { id: aliceEmail.id, userId: bob.id },
  })
  check("ingest as Bob of Alice's id is not found", bobIngest === null)
  const aliceIngest = await prisma.email.findFirst({
    where: { id: aliceEmail.id, userId: alice.id },
  })
  check("ingest as Alice of her id works", aliceIngest?.id === aliceEmail.id)

  // --- POST /api/links/[id]/analyze (loads nested email body) ---
  const bobAnalyze = await prisma.link.findFirst({
    where: { id: aliceLink.id, userId: bob.id },
    include: { email: { where: { userId: bob.id }, select: { rawContent: true } } },
  })
  check("analyze as Bob of Alice's link is not found", bobAnalyze === null)

  // Poisoned row: Bob owns a link that points at Alice's email.
  const poison = await prisma.link.create({
    data: {
      userId: bob.id,
      emailId: aliceEmail.id,
      url: "https://bob.example/poison",
      urlHash: "poison-hash",
      title: "Poison",
    },
  })
  const poisonWithFilter = await prisma.link.findFirst({
    where: { id: poison.id, userId: bob.id },
    include: { email: { where: { userId: bob.id }, select: { subject: true, rawContent: true } } },
  })
  check(
    "GET /api/links nested email where userId hides Alice's body",
    poisonWithFilter?.email == null
  )
  const poisonUnfiltered = await prisma.link.findUnique({
    where: { id: poison.id },
    include: { email: { select: { subject: true } } },
  })
  check(
    "unfiltered nested include would leak (why routes must pass where.userId)",
    poisonUnfiltered?.email?.subject === "Alice secret subject"
  )

  // --- POST /api/chat (text fallback) ---
  const bobChatEmails = await textSearchEmails(bob.id, "zebra", 10)
  const bobChatLinks = await textSearchLinks(bob.id, "zebra", 10)
  check("chat text search as Bob misses Alice's email", bobChatEmails.length === 0)
  check("chat text search as Bob misses Alice's link", bobChatLinks.length === 0)
  const aliceChatEmails = await textSearchEmails(alice.id, "zebra", 10)
  check("chat text search as Alice hits her email", aliceChatEmails.length === 1)

  // --- POST /api/sync gmailId dedup ---
  const bobSync = await prisma.email.findMany({
    where: { userId: bob.id, gmailId: { in: ["gm-shared-looking", "gm-bob"] } },
    select: { gmailId: true },
  })
  check(
    "sync as Bob does not treat Alice's gmailId as already processed",
    bobSync.length === 1 && bobSync[0].gmailId === "gm-bob"
  )
  await expectThrow("sync-style gmailId lookup without userId is rejected", () =>
    prisma.email.findMany({ where: { gmailId: { in: ["gm-shared-looking"] } } })
  )

  const bobSameGmail = await prisma.email.create({
    data: {
      userId: bob.id,
      gmailId: "gm-shared-looking",
      subject: "Bob's own copy",
      receivedAt: new Date("2026-01-03T00:00:00Z"),
    },
  })
  check("Bob can store the same gmailId as Alice", bobSameGmail.gmailId === "gm-shared-looking")

  // --- POST /api/embeddings/generate-emails raw UPDATE ---
  const updated = await prisma.$executeRaw`
    UPDATE "Email"
    SET "embeddingStatus" = 'SKIPPED'
    WHERE id = ${aliceEmail.id} AND "userId" = ${bob.id}
  `
  check("embedding UPDATE as Bob cannot touch Alice's row", updated === 0)
  const aliceStill = await prisma.email.findFirst({
    where: { id: aliceEmail.id, userId: alice.id },
    select: { embeddingStatus: true },
  })
  check("Alice's embedding status unchanged", aliceStill?.embeddingStatus !== "SKIPPED")

  // --- chat vector search ---
  const embedding = unitEmbedding()
  const embeddingStr = formatEmbeddingForPgVector(embedding)
  try {
    await prisma.$executeRaw`
      UPDATE "Email" SET embedding = ${embeddingStr}::vector, "embeddingStatus" = 'COMPLETED'
      WHERE id = ${aliceEmail.id}
    `
    await prisma.$executeRaw`
      UPDATE "Email" SET embedding = ${embeddingStr}::vector, "embeddingStatus" = 'COMPLETED'
      WHERE id = ${bobEmail.id}
    `
    await prisma.$executeRaw`
      UPDATE "Link" SET embedding = ${embeddingStr}::vector, "embeddingStatus" = 'COMPLETED'
      WHERE id = ${aliceLink.id}
    `
    await prisma.$executeRaw`
      UPDATE "Link" SET embedding = ${embeddingStr}::vector, "embeddingStatus" = 'COMPLETED'
      WHERE id = ${bobLink.id}
    `
    const bobHits = await searchSimilarContent(bob.id, embedding, 10, 0.1)
    check(
      "vector search as Bob does not return Alice",
      bobHits.length > 0 && bobHits.every((h) => h.id === bobEmail.id || h.id === bobLink.id)
    )
    const aliceHits = await searchSimilarContent(alice.id, embedding, 10, 0.1)
    check(
      "vector search as Alice does not return Bob",
      aliceHits.length > 0 && aliceHits.every((h) => h.id === aliceEmail.id || h.id === aliceLink.id)
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("vector") || message.includes("type") || message.includes("embedding")) {
      console.log("  skip  vector search (pgvector not available)", message)
    } else {
      throw error
    }
  }

  // --- tenant guard ---
  await expectThrow("unscoped Email.findMany throws", () => prisma.email.findMany())
  await expectThrow("unscoped Email.count throws", () => prisma.email.count())
  await expectThrow("Email.create without userId throws", () =>
    prisma.email.create({
      data: { gmailId: "x", receivedAt: new Date() } as never,
    })
  )

  // Known hole: findUnique by primary key still loads any mailbox. Handlers
  // must not use this with a client-supplied id.
  const leaked = await prisma.email.findUnique({ where: { id: aliceEmail.id } })
  check("findUnique(id) still loads Alice (do not use in handlers)", leaked?.subject === "Alice secret subject")

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
