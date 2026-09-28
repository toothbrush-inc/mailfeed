/**
 * Link likes: owner-scoped like/unlike, the liked filter, and liking never
 * touching read state. Needs a throwaway database:
 *
 *   docker run -d --name mailfeed-likes-test -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=mailfeed_test -p 5603:5432 pgvector/pgvector:pg16
 *   DATABASE_URL=postgresql://postgres:test@localhost:5603/mailfeed_test \
 *     npx prisma migrate deploy
 *   DATABASE_URL=postgresql://postgres:test@localhost:5603/mailfeed_test \
 *     npm run test:likes
 *   docker rm -f mailfeed-likes-test
 */
import { prisma, basePrisma } from "../lib/prisma"
import { setLinkLiked } from "../lib/link-likes"

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? "")
  }
}

// Same where clause GET /api/links builds for ?liked=true
function likedWhere(userId: string) {
  return { userId, parentLinkId: null, isLiked: true }
}

async function main() {
  await basePrisma.geminiBatch.deleteMany({})
  await basePrisma.linkReport.deleteMany({})
  await basePrisma.fetchAttempt.deleteMany({})
  await basePrisma.link.deleteMany({})
  await basePrisma.email.deleteMany({})
  await basePrisma.account.deleteMany({})
  await basePrisma.session.deleteMany({})
  await basePrisma.user.deleteMany({})

  const alice = await prisma.user.create({ data: { email: "alice-likes@example.com" } })
  const bob = await prisma.user.create({ data: { email: "bob-likes@example.com" } })

  const mkLink = (userId: string, n: string) =>
    prisma.link.create({ data: { userId, url: `https://${n}.example/`, urlHash: `${n}-hash` } })
  const aliceA = await mkLink(alice.id, "alice-a")
  const aliceB = await mkLink(alice.id, "alice-b")
  const bobLink = await mkLink(bob.id, "bob")

  // Alice likes her own link
  const liked = await setLinkLiked(aliceA.id, alice.id, true)
  check("Alice can like her link", liked?.isLiked === true && liked.likedAt instanceof Date, liked)

  const afterLike = await prisma.link.findUnique({ where: { id: aliceA.id } })
  check("liking does not mark as read", afterLike?.isRead === false && afterLike?.readAt === null, afterLike)

  // Bob cannot like (or unlike) Alice's link
  const bobTry = await setLinkLiked(aliceB.id, bob.id, true)
  check("Bob cannot like Alice's link (not found)", bobTry === null, bobTry)
  const bobUnlike = await setLinkLiked(aliceA.id, bob.id, false)
  check("Bob cannot unlike Alice's link (not found)", bobUnlike === null, bobUnlike)
  const aliceBNow = await prisma.link.findUnique({ where: { id: aliceB.id } })
  const aliceANow = await prisma.link.findUnique({ where: { id: aliceA.id } })
  check("Alice's links unchanged by Bob", aliceBNow?.isLiked === false && aliceANow?.isLiked === true)

  // Liked filter is per user
  await setLinkLiked(bobLink.id, bob.id, true)
  const aliceLiked = await prisma.link.findMany({ where: likedWhere(alice.id) })
  check(
    "liked filter returns only Alice's liked links",
    aliceLiked.length === 1 && aliceLiked[0].id === aliceA.id,
    aliceLiked.map((l) => l.id)
  )
  const bobLiked = await prisma.link.findMany({ where: likedWhere(bob.id) })
  check("liked filter returns only Bob's liked links", bobLiked.length === 1 && bobLiked[0].id === bobLink.id)

  // Liking a read link keeps it read; unliking clears likedAt only
  await prisma.link.update({ where: { id: aliceB.id }, data: { isRead: true, readAt: new Date() } })
  await setLinkLiked(aliceB.id, alice.id, true)
  const unliked = await setLinkLiked(aliceB.id, alice.id, false)
  check("Alice can unlike her link", unliked?.isLiked === false && unliked.likedAt === null, unliked)
  const aliceBAfter = await prisma.link.findUnique({ where: { id: aliceB.id } })
  check("like/unlike leaves read state as it was", aliceBAfter?.isRead === true && aliceBAfter?.readAt !== null)

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
