/**
 * Live round-trip test for encryption at rest + BYOK key storage.
 *
 * Needs a throwaway database and a KEK:
 *   docker run -d --name mailfeed-crypto-test -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=mailfeed_test -p 5599:5432 pgvector/pgvector:pg16
 *   DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
 *     npx prisma db push --skip-generate
 *   DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
 *     MAILFEED_KEK=$(openssl rand -base64 32) npx tsx scripts/test-encryption.ts
 *
 * Run WITHOUT MAILFEED_KEK/KMS_KEY_NAME to test the self-hosted default
 * instead: data stores plaintext, BYOK refuses, REQUIRE flag fails loudly.
 */
import { prisma, basePrisma } from "../lib/prisma"
import { getUserAiKeys, setUserAiKeys, maskAiKeys } from "../lib/user-keys"
import { findEmailIdsMatchingText, textSearchEmails } from "../lib/email-search"

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? "")
  }
}

async function plaintextModeMain() {
  console.log("(no KEK configured — testing the self-hosted plaintext default)")
  await basePrisma.linkReport.deleteMany({})
  await basePrisma.link.deleteMany({})
  await basePrisma.email.deleteMany({})
  await basePrisma.account.deleteMany({})
  await basePrisma.user.deleteMany({})

  const solo = await prisma.user.create({ data: { email: "solo@example.com" } })
  const email = await prisma.email.create({
    data: {
      userId: solo.id,
      gmailId: "gm-plain",
      subject: "Plain subject",
      rawContent: "Plain body",
      receivedAt: new Date("2026-01-01T00:00:00Z"),
    },
  })
  check("write succeeds without a KEK", email.subject === "Plain subject")
  const atRest = await basePrisma.email.findUniqueOrThrow({ where: { id: email.id } })
  check("stored plaintext, as before", atRest.subject === "Plain subject" && atRest.rawContent === "Plain body")
  const read = await prisma.email.findUniqueOrThrow({ where: { id: email.id } })
  check("reads unchanged", read.rawContent === "Plain body")

  const byokRefused = await setUserAiKeys(solo.id, { gemini: "AIza-x" }).then(
    () => false,
    () => true
  )
  check("BYOK storage refused without encryption", byokRefused)

  const { missingGeminiKeyMessage: plaintextHint } = await import("../lib/user-keys")
  check("missing-key hint points at .env without KEK", plaintextHint("Chat").includes(".env"))

  process.env.MAILFEED_REQUIRE_ENCRYPTION = "true"
  const writeRefused = await prisma.email
    .create({
      data: { userId: solo.id, gmailId: "gm-req", subject: "x", receivedAt: new Date("2026-01-02T00:00:00Z") },
    })
    .then(
      () => false,
      () => true
    )
  check("REQUIRE flag makes missing KEK fatal", writeRefused)
  delete process.env.MAILFEED_REQUIRE_ENCRYPTION

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

async function main() {
  if (!process.env.MAILFEED_KEK && !process.env.KMS_KEY_NAME) {
    return plaintextModeMain()
  }
  await basePrisma.linkReport.deleteMany({})
  await basePrisma.link.deleteMany({})
  await basePrisma.email.deleteMany({})
  await basePrisma.account.deleteMany({})
  await basePrisma.user.deleteMany({})

  const alice = await prisma.user.create({ data: { email: "alice@example.com" } })
  const bob = await prisma.user.create({ data: { email: "bob@example.com" } })

  // --- email fields encrypt at rest, decrypt on read ---
  const email = await prisma.email.create({
    data: {
      userId: alice.id,
      gmailId: "gm-1",
      subject: "Secret subject",
      snippet: "Secret snippet",
      rawContent: "Dear diary, this must never sit in plaintext.",
      receivedAt: new Date("2026-01-01T00:00:00Z"),
    },
  })
  check("create returns plaintext", email.subject === "Secret subject")

  const atRest = await basePrisma.email.findUniqueOrThrow({ where: { id: email.id } })
  check("subject ciphertext at rest", atRest.subject?.startsWith(`enc.v1.${alice.id}.`) === true, atRest.subject)
  check("snippet ciphertext at rest", atRest.snippet?.startsWith("enc.v1.") === true)
  check("rawContent ciphertext at rest", atRest.rawContent?.startsWith("enc.v1.") === true)
  check("rawContent not readable at rest", !atRest.rawContent?.includes("diary"))

  const read = await prisma.email.findUniqueOrThrow({ where: { id: email.id } })
  check("findUnique decrypts", read.rawContent === "Dear diary, this must never sit in plaintext.")

  // --- text search must decrypt; SQL ILIKE cannot match ciphertext ---
  const sqlMiss = await basePrisma.email.findMany({
    where: { userId: alice.id, subject: { contains: "Secret", mode: "insensitive" } },
  })
  check("SQL ILIKE cannot match ciphertext", sqlMiss.length === 0)
  const bySubject = await textSearchEmails(alice.id, "secret subject", 5)
  check("text search hits encrypted subject", bySubject.length === 1 && bySubject[0].id === email.id)
  const byBody = await textSearchEmails(alice.id, "diary", 5)
  check("text search hits encrypted body", byBody.length === 1 && byBody[0].id === email.id)
  const ids = await findEmailIdsMatchingText(alice.id, "SNIPPET")
  check("id search is case-insensitive", ids.length === 1 && ids[0] === email.id)

  // --- nested include decrypts ---
  const link = await prisma.link.create({
    data: { userId: alice.id, emailId: email.id, url: "https://example.com/a", urlHash: "h1" },
  })
  const linkWithEmail = await prisma.link.findUniqueOrThrow({
    where: { id: link.id },
    include: { email: true },
  })
  check("nested include decrypts", linkWithEmail.email?.subject === "Secret subject")

  // --- raw SQL through the extended client decrypts; base client does not ---
  const rawRows = await prisma.$queryRaw<
    Array<{ subject: string | null }>
  >`SELECT subject FROM "Email" WHERE id = ${email.id}`
  check("extended $queryRaw decrypts", rawRows[0]?.subject === "Secret subject", rawRows[0]?.subject)
  const baseRows = await basePrisma.$queryRaw<
    Array<{ subject: string | null }>
  >`SELECT subject FROM "Email" WHERE id = ${email.id}`
  check("base $queryRaw stays ciphertext", baseRows[0]?.subject?.startsWith("enc.v1.") === true)

  // --- per-user isolation: bob's DEK cannot appear in alice's rows ---
  const bobEmail = await prisma.email.create({
    data: {
      userId: bob.id,
      gmailId: "gm-2",
      subject: "Bob's subject",
      receivedAt: new Date("2026-01-02T00:00:00Z"),
    },
  })
  const bobAtRest = await basePrisma.email.findUniqueOrThrow({ where: { id: bobEmail.id } })
  check("bob's ciphertext keyed to bob", bobAtRest.subject?.startsWith(`enc.v1.${bob.id}.`) === true)
  const users = await basePrisma.user.findMany({ orderBy: { email: "asc" } })
  check("distinct wrapped DEKs", users[0].dekWrapped !== users[1].dekWrapped && !!users[0].dekWrapped)
  const aliceSecret = await textSearchEmails(alice.id, "secret", 5)
  const bobSecret = await textSearchEmails(bob.id, "secret", 5)
  check("text search stays in the owner's mailbox", aliceSecret.length === 1 && bobSecret.length === 0)

  // --- account tokens; update path resolves owner from the row ---
  const account = await prisma.account.create({
    data: {
      userId: alice.id,
      type: "oauth",
      provider: "google",
      providerAccountId: "pa-1",
      access_token: "ya29.super-secret",
      refresh_token: "1//refresh-secret",
    },
  })
  await prisma.account.update({
    where: { id: account.id },
    data: { access_token: "ya29.rotated" },
  })
  const accountAtRest = await basePrisma.account.findUniqueOrThrow({ where: { id: account.id } })
  check("access_token ciphertext at rest", accountAtRest.access_token?.startsWith("enc.v1.") === true)
  check("refresh_token ciphertext at rest", accountAtRest.refresh_token?.startsWith("enc.v1.") === true)
  const accountRead = await prisma.account.findFirstOrThrow({ where: { userId: alice.id } })
  check("rotated token decrypts", accountRead.access_token === "ya29.rotated")

  // --- DEK mint race: two concurrent first writes must converge on one DEK ---
  const carol = await prisma.user.create({ data: { email: "carol@example.com" } })
  const { clearDekCache } = await import("../lib/crypto/dek")
  clearDekCache()
  const [c1, c2] = await Promise.all([
    prisma.email.create({
      data: { userId: carol.id, gmailId: "gm-c1", subject: "carol one", receivedAt: new Date("2026-01-03T00:00:00Z") },
    }),
    prisma.email.create({
      data: { userId: carol.id, gmailId: "gm-c2", subject: "carol two", receivedAt: new Date("2026-01-04T00:00:00Z") },
    }),
  ])
  clearDekCache()
  const carolRead = await prisma.email.findMany({ where: { userId: carol.id }, orderBy: { gmailId: "asc" } })
  check(
    "concurrent first writes both decrypt after cache clear",
    carolRead[0].subject === "carol one" && carolRead[1].subject === "carol two",
    [c1.id, c2.id]
  )

  // --- BYOK keys: encrypted, masked, never in the transparent read path ---
  await setUserAiKeys(alice.id, { gemini: "AIzaSyTest1234" })
  const keys = await getUserAiKeys(alice.id)
  check("key round-trips", keys.gemini === "AIzaSyTest1234")
  check("mask shows last 4 only", maskAiKeys(keys).gemini === "••••1234")
  const aliceRow = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })
  check("apiKeysEnc opaque via extended client", aliceRow.apiKeysEnc?.startsWith("enck.v1.") === true, aliceRow.apiKeysEnc?.slice(0, 12))
  check("apiKeysEnc does not leak key", !JSON.stringify(aliceRow).includes("AIzaSyTest1234"))
  await setUserAiKeys(alice.id, { gemini: null })
  const cleared = await getUserAiKeys(alice.id)
  check("clearing removes the key", cleared.gemini === undefined)
  await setUserAiKeys(alice.id, { gemini: "AIzaSyTest1234" })

  // --- key resolution honors MAILFEED_SHARED_ENV_KEYS ---
  process.env.GEMINI_API_KEY = "host-key"
  const { resolveGeminiKey, resolveApiKey, missingGeminiKeyMessage } = await import("../lib/user-keys")
  check("user key wins over host key", resolveGeminiKey({ gemini: "user-key" }) === "user-key")
  check("host key serves keyless users by default", resolveGeminiKey({}) === "host-key")
  check("missing-key hint points at Settings when encrypted", missingGeminiKeyMessage("Chat").includes("Settings"))
  process.env.MAILFEED_SHARED_ENV_KEYS = "false"
  check("sharing off: keyless users get nothing", resolveGeminiKey({}) === undefined)
  check("sharing off: env fallback is also blocked", resolveApiKey(undefined, "GEMINI_API_KEY") === undefined)
  check("sharing off: user key still works", resolveGeminiKey({ gemini: "user-key" }) === "user-key")
  delete process.env.MAILFEED_SHARED_ENV_KEYS
  delete process.env.GEMINI_API_KEY

  // --- crafted ciphertext-lookalike input (attacker-controlled subjects) ---
  const fakeInvalid = "enc.v1.hax.not-base64.zz"
  const iv = Buffer.alloc(12, 7).toString("base64url")
  const payload = Buffer.alloc(48, 9).toString("base64url")
  const fakeValid = `enc.v1.${bob.id}.${iv}.${payload}`
  const crafted = await prisma.email.create({
    data: {
      userId: alice.id,
      gmailId: "gm-crafted",
      subject: fakeInvalid,
      snippet: fakeValid,
      receivedAt: new Date("2026-01-05T00:00:00Z"),
    },
  })
  const craftedAtRest = await basePrisma.email.findUniqueOrThrow({ where: { id: crafted.id } })
  check(
    "lookalike input still encrypted under owner",
    craftedAtRest.subject?.startsWith(`enc.v1.${alice.id}.`) === true &&
      craftedAtRest.snippet?.startsWith(`enc.v1.${alice.id}.`) === true
  )
  const craftedRead = await prisma.email.findUniqueOrThrow({ where: { id: crafted.id } })
  check(
    "lookalike input round-trips verbatim without throwing",
    craftedRead.subject === fakeInvalid && craftedRead.snippet === fakeValid
  )

  // --- crypto-shredding: delete the user, rows cascade with the DEK ---
  await basePrisma.user.delete({ where: { id: carol.id } })
  const orphans = await basePrisma.email.count({ where: { userId: carol.id } })
  check("cascade removes user rows", orphans === 0)

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
