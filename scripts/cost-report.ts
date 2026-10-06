/**
 * Estimate AI spend per user, per day and per link from what the database
 * already stores. Nothing records real token usage yet, so this rebuilds each
 * call's input from the content the analysis saw (rawHtml, else contentText),
 * and its output from the stored summary, key points, tags and child links,
 * plus an assumed thinking budget. Treat the numbers as an estimate.
 *
 * Covered: link analysis (IngestLink), email ingest (IngestEmail), link and
 * email embeddings. Not covered: chat (no history is stored), analyses
 * that failed and later succeeded (analysisAttempts resets on success),
 * hosting, database and Gmail API (free).
 *
 *   npm run cost:report                              # last 30 days
 *   npm run cost:report -- --days 7
 *   npm run cost:report -- --thinking 4000           # thinking tokens per analysis call
 *   npm run cost:report -- --chars-per-token 3.5
 *
 * On the hosted instance it ships in the worker image; run it there with
 * `docker exec <mailfeed-worker> npm run --silent cost:report`.
 */
import "dotenv/config"
import { basePrisma as prisma } from "@/lib/prisma"
import { BAML_CLIENTS } from "@/lib/ai-provider"
import { DEFAULT_SETTINGS } from "@/lib/settings"
import { LONG_CONTEXT_TOKENS, priceCall } from "@/lib/ai-pricing"

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}

const DAYS = arg("days", 30)
// HTML tokenizes denser than prose; 4 chars/token is a middle estimate.
const CHARS_PER_TOKEN = arg("chars-per-token", 4)
// Gemini 3.x Pro thinks by default and bills thinking as output.
const THINKING_TOKENS = arg("thinking", 2000)
const TOP_N = arg("top", 10)

// Mirrors lib/gemini-batch.ts MAX_HTML_CHARS; the live path sends everything.
const BATCH_MAX_HTML_CHARS = 24_000
// Mirrors lib/embeddings.ts MAX_CONTENT_LENGTH.
const EMBED_MAX_CHARS = 8_000
// IngestLink prompt template plus BAML's output-format schema.
const PROMPT_OVERHEAD_TOKENS = 900
// JSON keys, enums and tags around the stored fields.
const OUTPUT_OVERHEAD_TOKENS = 150
const TOKENS_PER_CHILD_LINK = 30
// Encrypted email fields are base64 of ciphertext: ~4/3 the plaintext.
const ENCRYPTED_INFLATION = 4 / 3

const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)

function callCost(model: string, inTok: number, outTok: number, batch: boolean, at: Date): number {
  const cost = priceCall({ model, inputTokens: inTok, outputTokens: outTok, batch, at })
  if (cost === null) throw new Error(`No price for ${model}; add it to lib/ai-pricing.ts`)
  return cost
}

const usd = (n: number) => (n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`)
const day = (d: Date) => d.toISOString().slice(0, 10)

interface UserRow {
  id: string
  email: string | null
  byok: boolean
  settings: { ai?: { bamlClient?: string; embeddingModel?: string } } | null
}

interface LinkRow {
  id: string
  userId: string
  url: string
  at: Date
  inputChars: number
  outputChars: number
  children: number
  failedAttempts: number
  analyzed: boolean
  viaBatch: boolean
}

interface EmbedRow {
  userId: string
  at: Date
  chars: number
  encrypted: boolean
  viaBatch: boolean
}

interface IngestRow {
  userId: string
  at: Date
  chars: number
  encrypted: boolean
}

interface Tally {
  analysis: number
  failed: number
  embeddings: number
  emailIngest: number
  links: number
  calls: number
  inTok: number
  outTok: number
  days: Set<string>
}

const emptyTally = (): Tally => ({
  analysis: 0, failed: 0, embeddings: 0, emailIngest: 0, links: 0, calls: 0, inTok: 0, outTok: 0, days: new Set(),
})
const total = (t: Tally) => t.analysis + t.failed + t.embeddings + t.emailIngest

async function main() {
  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000)

  const users = await prisma.$queryRaw<UserRow[]>`
    SELECT id, email, "apiKeysEnc" IS NOT NULL AS byok, settings FROM "User"`
  const userById = new Map(users.map((u) => [u.id, u]))

  // Analyzed links, plus links whose analysis is currently failing (each
  // failed attempt still paid for input, and usually output).
  const links = await prisma.$queryRaw<LinkRow[]>`
    SELECT l.id, l."userId", l.url,
      COALESCE(l."analyzedAt", l."updatedAt") AS at,
      COALESCE(length(NULLIF(l."rawHtml", '')), length(l."contentText"), 0)::int AS "inputChars",
      (COALESCE(length(l."aiSummary"), 0)
        + COALESCE(length(array_to_string(l."aiKeyPoints", ' ')), 0)
        + COALESCE(length(l."highlightReason"), 0))::int AS "outputChars",
      (SELECT count(*) FROM "Link" c WHERE c."parentLinkId" = l.id)::int AS children,
      l."analysisAttempts" AS "failedAttempts",
      l."analyzedAt" IS NOT NULL AS analyzed,
      EXISTS (
        SELECT 1 FROM "GeminiBatch" g
        WHERE g.kind = 'ANALYZE_LINKS' AND g.status = 'SUCCEEDED' AND l.id = ANY(g."itemIds")
      ) AS "viaBatch"
    FROM "Link" l
    WHERE (l."analyzedAt" >= ${since})
       OR (l."analyzedAt" IS NULL AND l."analysisAttempts" > 0 AND l."updatedAt" >= ${since})`

  const linkEmbeds = await prisma.$queryRaw<EmbedRow[]>`
    SELECT l."userId", l."embeddedAt" AS at,
      (COALESCE(length(l.title), 0)
        + COALESCE(length(COALESCE(l."contentText", l.description, l."aiSummary")), 0))::int AS chars,
      false AS encrypted,
      EXISTS (
        SELECT 1 FROM "GeminiBatch" g
        WHERE g.kind = 'EMBED_LINKS' AND g.status = 'SUCCEEDED' AND l.id = ANY(g."itemIds")
      ) AS "viaBatch"
    FROM "Link" l
    WHERE l."embeddedAt" >= ${since}`

  const emailEmbeds = await prisma.$queryRaw<EmbedRow[]>`
    SELECT e."userId", e."embeddedAt" AS at,
      (COALESCE(length(e.subject), 0) + COALESCE(length(COALESCE(e."rawContent", e.snippet)), 0))::int AS chars,
      COALESCE(e."rawContent", e.snippet, '') LIKE 'enc.v1.%' AS encrypted,
      EXISTS (
        SELECT 1 FROM "GeminiBatch" g
        WHERE g.kind = 'EMBED_EMAILS' AND g.status = 'SUCCEEDED' AND e.id = ANY(g."itemIds")
      ) AS "viaBatch"
    FROM "Email" e
    WHERE e."embeddedAt" >= ${since}`

  const ingests = await prisma.$queryRaw<IngestRow[]>`
    SELECT e."userId", e."ingestedAt" AS at,
      (COALESCE(length(e.subject), 0) + COALESCE(length(e."rawContent"), 0))::int AS chars,
      COALESCE(e."rawContent", '') LIKE 'enc.v1.%' AS encrypted
    FROM "Email" e
    WHERE e."ingestedAt" >= ${since}`

  const analysisModel = (u?: UserRow) => {
    const client = u?.settings?.ai?.bamlClient ?? DEFAULT_SETTINGS.ai.bamlClient
    return BAML_CLIENTS.find((c) => c.name === client)?.model ?? "gemini-3.8-flash"
  }
  const embedModel = (u?: UserRow) => u?.settings?.ai?.embeddingModel ?? DEFAULT_SETTINGS.ai.embeddingModel

  const byUser = new Map<string, Tally>()
  const byDay = new Map<string, Tally>()
  const tallies = (userId: string, at: Date) => {
    if (!byUser.has(userId)) byUser.set(userId, emptyTally())
    if (!byDay.has(day(at))) byDay.set(day(at), emptyTally())
    const u = byUser.get(userId)!
    u.days.add(day(at))
    return [u, byDay.get(day(at))!]
  }

  const perLink: Array<{ url: string; userId: string; inTok: number; cost: number; viaBatch: boolean }> = []
  let liveLinks = 0
  let batchLinks = 0
  let longContextCalls = 0

  for (const l of links) {
    const model = analysisModel(userById.get(l.userId))
    const htmlChars = l.viaBatch ? Math.min(l.inputChars, BATCH_MAX_HTML_CHARS) : l.inputChars
    const inTok = PROMPT_OVERHEAD_TOKENS + tokens(htmlChars)
    const outTok =
      THINKING_TOKENS + OUTPUT_OVERHEAD_TOKENS + tokens(l.outputChars) + l.children * TOKENS_PER_CHILD_LINK
    const one = callCost(model, inTok, outTok, l.viaBatch, l.at)
    if (inTok > LONG_CONTEXT_TOKENS) longContextCalls++

    for (const t of tallies(l.userId, l.at)) {
      if (l.analyzed) {
        t.analysis += one
        t.links++
      }
      // Failed attempts on links still unanalyzed; assume they ran live.
      t.failed += l.failedAttempts * callCost(model, inTok, outTok, false, l.at)
      const calls = (l.analyzed ? 1 : 0) + l.failedAttempts
      t.calls += calls
      t.inTok += inTok * calls
      t.outTok += outTok * calls
    }
    if (l.analyzed) {
      perLink.push({ url: l.url, userId: l.userId, inTok, cost: one, viaBatch: l.viaBatch })
      if (l.viaBatch) batchLinks++
      else liveLinks++
    }
  }

  for (const e of [...linkEmbeds, ...emailEmbeds]) {
    const chars = Math.min(e.encrypted ? e.chars / ENCRYPTED_INFLATION : e.chars, EMBED_MAX_CHARS)
    const cost = callCost(embedModel(userById.get(e.userId)), tokens(chars), 0, e.viaBatch, e.at)
    for (const t of tallies(e.userId, e.at)) t.embeddings += cost
  }

  for (const e of ingests) {
    const chars = e.encrypted ? e.chars / ENCRYPTED_INFLATION : e.chars
    const model = analysisModel(userById.get(e.userId))
    const cost = callCost(model, PROMPT_OVERHEAD_TOKENS + tokens(chars), THINKING_TOKENS + 500, false, e.at)
    for (const t of tallies(e.userId, e.at)) t.emailIngest += cost
  }

  const all = emptyTally()
  for (const t of byUser.values()) {
    all.analysis += t.analysis
    all.failed += t.failed
    all.embeddings += t.embeddings
    all.emailIngest += t.emailIngest
    all.links += t.links
    all.calls += t.calls
    all.inTok += t.inTok
    all.outTok += t.outTok
  }
  const grand = total(all)

  console.log(`\nMailFeed AI cost estimate — last ${DAYS} days (since ${day(since)})`)
  console.log(
    `Assumes ${CHARS_PER_TOKEN} chars/token, ${THINKING_TOKENS} thinking tokens per analysis call. Chat is not included.\n`
  )

  console.log("Totals")
  console.table({
    "Link analysis": usd(all.analysis),
    "Failed analysis (still failing)": usd(all.failed),
    Embeddings: usd(all.embeddings),
    "Email ingest": usd(all.emailIngest),
    Total: usd(grand),
  })

  const activeUsers = byUser.size
  const userDays = [...byUser.values()].reduce((n, t) => n + t.days.size, 0)
  console.log("Unit costs")
  console.table({
    "Links analyzed": all.links,
    "  via batch (50% off, HTML capped at 24k chars)": batchLinks,
    "  live (full HTML, no cap)": liveLinks,
    "Calls over 200k input tokens (2x rate)": longContextCalls,
    "Avg input tokens / analysis call": all.calls ? Math.round(all.inTok / all.calls) : 0,
    "Cost per analyzed link": usd(all.links ? (all.analysis + all.failed) / all.links : 0),
    "Active users": activeUsers,
    "Cost per active user per day (calendar)": usd(activeUsers ? grand / activeUsers / DAYS : 0),
    "Cost per user per active day": usd(userDays ? grand / userDays : 0),
    "Projected cost per active user per month": usd(activeUsers ? (grand / activeUsers / DAYS) * 30 : 0),
  })

  console.log("Per user (BYOK = user's own Gemini key pays for analysis, not the host)")
  console.table(
    [...byUser.entries()]
      .sort((a, b) => total(b[1]) - total(a[1]))
      .map(([id, t]) => ({
        user: userById.get(id)?.email ?? id,
        byok: userById.get(id)?.byok ? "yes" : "no",
        model: analysisModel(userById.get(id)),
        links: t.links,
        "active days": t.days.size,
        analysis: usd(t.analysis + t.failed),
        embeddings: usd(t.embeddings),
        total: usd(total(t)),
        "per link": usd(t.links ? total(t) / t.links : 0),
        "per day": usd(total(t) / DAYS),
      }))
  )

  console.log("Per day")
  console.table(
    [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([d, t]) => ({ day: d, links: t.links, total: usd(total(t)) }))
  )

  console.log(`Most expensive ${TOP_N} analyses`)
  console.table(
    perLink
      .sort((a, b) => b.cost - a.cost)
      .slice(0, TOP_N)
      .map((l) => ({
        url: l.url.length > 70 ? `${l.url.slice(0, 67)}...` : l.url,
        user: userById.get(l.userId)?.email ?? l.userId,
        "input tokens": l.inTok,
        path: l.viaBatch ? "batch" : "live",
        cost: usd(l.cost),
      }))
  )

  const hostPaid = [...byUser.entries()]
    .filter(([id]) => !userById.get(id)?.byok)
    .reduce((n, [, t]) => n + total(t), 0)
  console.log(
    `Host-paid estimate (users without their own key, if MAILFEED_SHARED_ENV_KEYS is on): ${usd(hostPaid)} of ${usd(grand)}\n`
  )
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
