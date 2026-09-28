/**
 * Stuck-link recovery: links left in PENDING/FETCHING/ANALYZING by a crash
 * are retried once, and links whose fetch finished (failed, paywalled) are
 * never fetched again. Wipes every table it touches, so it needs a throwaway
 * database:
 *
 *   docker run -d --name mailfeed-recovery-test -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=mailfeed_test -p 5599:5432 pgvector/pgvector:pg16
 *   DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
 *     npx prisma migrate deploy
 *   DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
 *     npx tsx scripts/test-stuck-recovery.ts
 *   docker rm -f mailfeed-recovery-test
 *
 * The retried link points at a closed local port, so its fetch fails; the
 * wayback fallback may still call archive.org.
 */
import { prisma, basePrisma } from "../lib/prisma"
import { retryInterruptedFetches } from "../lib/sync-user"
import { recoverInterruptedAnalysis } from "../lib/gemini-batch"

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? "")
  }
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

  const user = await prisma.user.create({
    data: { email: "recovery-test@example.com", hiddenDomains: ["hidden.example"] },
  })
  const email = await prisma.email.create({
    data: {
      userId: user.id,
      gmailId: "gm-recovery",
      subject: "Recovery test",
      rawContent: "body",
      receivedAt: new Date("2026-01-01T00:00:00Z"),
    },
  })

  let seq = 0
  async function makeLink(
    fetchStatus: "PENDING" | "FETCHING" | "ANALYZING" | "FETCHED" | "FAILED" | "PAYWALL_DETECTED",
    opts: { url?: string; domain?: string; hoursOld?: number; fetchError?: string; parentLinkId?: string } = {}
  ) {
    const n = ++seq
    const link = await prisma.link.create({
      data: {
        userId: user.id,
        emailId: email.id,
        url: opts.url ?? `https://recovery.example/${n}`,
        urlHash: `recovery-${n}`,
        domain: opts.domain ?? "recovery.example",
        fetchStatus,
        fetchError: opts.fetchError,
        parentLinkId: opts.parentLinkId,
        contentText: fetchStatus === "ANALYZING" ? "some text" : undefined,
      },
    })
    // @updatedAt ignores values passed through Prisma, so backdate in SQL
    const hoursOld = opts.hoursOld ?? 30
    await basePrisma.$executeRaw`UPDATE "Link" SET "updatedAt" = now() - make_interval(hours => ${hoursOld}) WHERE id = ${link.id}`
    return link
  }

  const get = (id: string) => prisma.link.findUnique({ where: { id } })

  // --- Fetch recovery ---
  const stuckFetching = await makeLink("FETCHING", { url: "http://127.0.0.1:9/stuck" })
  const recentFetching = await makeLink("FETCHING", { hoursOld: 1 })
  const alreadyRetried = await makeLink("PENDING", { fetchError: "Fetch was interrupted; retrying" })
  const nested = await makeLink("FETCHING", { parentLinkId: stuckFetching.id })
  const hidden = await makeLink("PENDING", { domain: "hidden.example", url: "https://hidden.example/x" })
  const failed = await makeLink("FAILED", { fetchError: "HTTP 404" })
  const paywalled = await makeLink("PAYWALL_DETECTED")

  const retried = await retryInterruptedFetches(user.id, { triggerAi: false })
  check("retries exactly one link", retried === 1, retried)

  const s1 = await get(stuckFetching.id)
  check("stuck FETCHING link was fetched again and finished", s1?.fetchStatus === "FAILED", s1?.fetchStatus)
  check("its retry marker was replaced by the real error", !!s1?.fetchError && !s1.fetchError.includes("retrying"), s1?.fetchError)
  const attempts = await prisma.fetchAttempt.count({ where: { linkId: stuckFetching.id } })
  check("its fetch attempts were recorded", attempts > 0, attempts)

  const s2 = await get(recentFetching.id)
  check("recent FETCHING link left alone", s2?.fetchStatus === "FETCHING", s2?.fetchStatus)

  const s3 = await get(alreadyRetried.id)
  check("link stuck again after its retry is FAILED, not fetched", s3?.fetchStatus === "FAILED", s3?.fetchStatus)
  check("its error says it was interrupted", s3?.fetchError === "Fetch was interrupted", s3?.fetchError)
  const s3Attempts = await prisma.fetchAttempt.count({ where: { linkId: alreadyRetried.id } })
  check("it made no fetch attempt", s3Attempts === 0, s3Attempts)

  const s4 = await get(nested.id)
  check("stuck nested link is FAILED without a retry", s4?.fetchStatus === "FAILED", s4?.fetchStatus)

  const s5 = await get(hidden.id)
  check("hidden-domain link stays parked in PENDING", s5?.fetchStatus === "PENDING" && s5.fetchError === null, s5)

  const s6 = await get(failed.id)
  check("FAILED link untouched", s6?.fetchStatus === "FAILED" && s6.fetchError === "HTTP 404", s6)
  const s7 = await get(paywalled.id)
  check("PAYWALL_DETECTED link untouched", s7?.fetchStatus === "PAYWALL_DETECTED", s7?.fetchStatus)
  const untouchedAttempts = await prisma.fetchAttempt.count({ where: { linkId: { in: [failed.id, paywalled.id] } } })
  check("failed and paywalled links were not fetched", untouchedAttempts === 0, untouchedAttempts)

  const again = await retryInterruptedFetches(user.id, { triggerAi: false })
  check("second run retries nothing", again === 0, again)

  // --- Analysis recovery ---
  const stuckAnalyzing = await makeLink("ANALYZING")
  const recentAnalyzing = await makeLink("ANALYZING", { hoursOld: 1 })
  const batchAnalyzing = await makeLink("ANALYZING")
  await prisma.geminiBatch.create({
    data: {
      userId: user.id,
      geminiName: "batches/recovery-test",
      kind: "ANALYZE_LINKS",
      status: "RUNNING",
      itemIds: [batchAnalyzing.id],
    },
  })

  const recovered = await recoverInterruptedAnalysis(user.id)
  check("requeues exactly one analysis", recovered === 1, recovered)

  const a1 = await get(stuckAnalyzing.id)
  check("stuck ANALYZING link back to FETCHED", a1?.fetchStatus === "FETCHED", a1?.fetchStatus)
  check("it counts as an analysis attempt", a1?.analysisAttempts === 1, a1?.analysisAttempts)
  check("its analysisError says it was interrupted", a1?.analysisError === "Analysis was interrupted", a1?.analysisError)

  const a2 = await get(recentAnalyzing.id)
  check("recent ANALYZING link left alone", a2?.fetchStatus === "ANALYZING", a2?.fetchStatus)
  const a3 = await get(batchAnalyzing.id)
  check("ANALYZING link in a running batch left alone", a3?.fetchStatus === "ANALYZING", a3?.fetchStatus)

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
