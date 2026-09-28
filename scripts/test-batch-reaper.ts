/**
 * Gemini batch reaper: stuck batches must not starve newer ones, and a batch
 * that cannot be collected within 72h is expired and its items requeued.
 * Wipes every table it touches, so it needs a throwaway database:
 *
 *   docker run -d --name mailfeed-reaper-test -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=mailfeed_test -p 5599:5432 pgvector/pgvector:pg16
 *   DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
 *     npx prisma migrate deploy
 *   DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
 *     npx tsx scripts/test-batch-reaper.ts
 *   docker rm -f mailfeed-reaper-test
 *
 * No real Gemini key is needed. The failed-lookup checks send a made-up key to
 * the Gemini API, so they need network access (any error counts as a failure).
 */
import { prisma, basePrisma } from "../lib/prisma"
import { reapPendingBatches } from "../lib/gemini-batch"

const HOUR = 60 * 60 * 1000

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? "")
  }
}

function hoursAgo(h: number) {
  return new Date(Date.now() - h * HOUR)
}

async function main() {
  if (!process.env.DATABASE_URL?.includes("_test")) {
    throw new Error("Refusing to run: DATABASE_URL must point at a throwaway *_test database")
  }

  await basePrisma.geminiBatch.deleteMany({})
  await basePrisma.linkReport.deleteMany({})
  await basePrisma.fetchAttempt.deleteMany({})
  await basePrisma.link.deleteMany({})
  await basePrisma.email.deleteMany({})
  await basePrisma.account.deleteMany({})
  await basePrisma.session.deleteMany({})
  await basePrisma.user.deleteMany({})

  const user = await prisma.user.create({ data: { email: "reaper-test@example.com" } })
  const email = await prisma.email.create({
    data: {
      userId: user.id,
      gmailId: "gm-reaper",
      subject: "Reaper test",
      rawContent: "body",
      receivedAt: new Date("2026-01-01T00:00:00Z"),
    },
  })

  async function makeLink(name: string, embeddingStatus = "PENDING") {
    return prisma.link.create({
      data: {
        userId: user.id,
        emailId: email.id,
        url: `https://reaper.example/${name}`,
        urlHash: `reaper-${name}`,
        fetchStatus: "ANALYZING",
        embeddingStatus,
      },
    })
  }

  let batchSeq = 0
  async function makeBatch(kind: string, itemIds: string[], submittedAt: Date) {
    return prisma.geminiBatch.create({
      data: {
        userId: user.id,
        geminiName: `batches/reaper-test-${++batchSeq}`,
        kind,
        status: "PENDING",
        itemIds,
        submittedAt,
      },
    })
  }

  const batch = (id: string) => prisma.geminiBatch.findUniqueOrThrow({ where: { id } })
  const link = (id: string) => prisma.link.findUniqueOrThrow({ where: { id } })

  // --- No Gemini key at all ---
  process.env.MAILFEED_SHARED_ENV_KEYS = "false"
  delete process.env.GEMINI_API_KEY

  const recentLink = await makeLink("recent-no-key")
  const recentNoKey = await makeBatch("ANALYZE_LINKS", [recentLink.id], hoursAgo(3))
  // 49 stuck recent batches fill the rest of the 50-per-tick window...
  for (let i = 0; i < 49; i++) await makeBatch("ANALYZE_LINKS", [], hoursAgo(2))
  // ...and the stale ones are inserted last, so only oldest-first reaches them.
  const oldLink = await makeLink("old-no-key")
  const oldNoKey = await makeBatch("ANALYZE_LINKS", [oldLink.id], hoursAgo(80))
  const oldEmbedLink = await makeLink("old-embed", "PROCESSING")
  const oldEmbed = await makeBatch("EMBED_LINKS", [oldEmbedLink.id], hoursAgo(80))

  await reapPendingBatches()

  const r1 = await batch(recentNoKey.id)
  check("no key, 3h old: batch still in flight", r1.status === "PENDING", r1.status)
  const l1 = await link(recentLink.id)
  check("no key, 3h old: link still ANALYZING", l1.fetchStatus === "ANALYZING", l1.fetchStatus)

  const r2 = await batch(oldNoKey.id)
  check("no key, 80h old: reached despite 50 newer stuck batches", r2.status !== "PENDING", r2.status)
  check("no key, 80h old: batch EXPIRED", r2.status === "EXPIRED", r2.status)
  check("no key, 80h old: completedAt set", r2.completedAt !== null)
  check("no key, 80h old: error explains why", !!r2.error?.includes("72h"), r2.error)
  const l2 = await link(oldLink.id)
  check("no key, 80h old: link back to FETCHED", l2.fetchStatus === "FETCHED", l2.fetchStatus)
  check("no key, 80h old: analysisError recorded", !!l2.analysisError, l2.analysisError)
  check("no key, 80h old: analysisAttempts incremented", l2.analysisAttempts === 1, l2.analysisAttempts)

  const r3 = await batch(oldEmbed.id)
  check("embed batch, 80h old: EXPIRED", r3.status === "EXPIRED", r3.status)
  const l3 = await link(oldEmbedLink.id)
  check("embed batch, 80h old: embeddingStatus FAILED", l3.embeddingStatus === "FAILED", l3.embeddingStatus)
  check("embed batch, 80h old: fetchStatus untouched", l3.fetchStatus === "ANALYZING", l3.fetchStatus)

  // --- Key present, but the lookup fails ---
  await prisma.geminiBatch.deleteMany({ where: { userId: user.id, itemIds: { isEmpty: true } } })
  process.env.MAILFEED_SHARED_ENV_KEYS = "true"
  process.env.GEMINI_API_KEY = "reaper-test-invalid-key"

  const recentBadLink = await makeLink("recent-bad-lookup")
  const recentBad = await makeBatch("ANALYZE_LINKS", [recentBadLink.id], hoursAgo(1))
  const oldBadLink = await makeLink("old-bad-lookup")
  const oldBad = await makeBatch("ANALYZE_LINKS", [oldBadLink.id], hoursAgo(80))

  await reapPendingBatches()

  const r4 = await batch(recentBad.id)
  check("failed lookup, 1h old: batch still in flight", r4.status === "PENDING", r4.status)
  const l4 = await link(recentBadLink.id)
  check("failed lookup, 1h old: link still ANALYZING", l4.fetchStatus === "ANALYZING", l4.fetchStatus)

  const r5 = await batch(oldBad.id)
  check("failed lookup, 80h old: batch EXPIRED", r5.status === "EXPIRED", r5.status)
  check("failed lookup, 80h old: error explains why", !!r5.error?.includes("lookup still failing"), r5.error)
  const l5 = await link(oldBadLink.id)
  check("failed lookup, 80h old: link back to FETCHED", l5.fetchStatus === "FETCHED", l5.fetchStatus)

  const r6 = await batch(recentNoKey.id)
  check("earlier recent batch still in flight after a second tick", r6.status === "PENDING", r6.status)

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
