import { prisma } from "@/lib/prisma"

/**
 * Like or unlike a link owned by `userId`. Scoped by owner, so another
 * user's link is treated as not found (returns null). Never touches read
 * state: liking is not reading.
 */
export async function setLinkLiked(linkId: string, userId: string, liked: boolean) {
  const where = { id: linkId, userId }
  const { count } = await prisma.link.updateMany({
    where,
    data: { isLiked: liked, likedAt: liked ? new Date() : null },
  })
  if (count === 0) return null

  return prisma.link.findFirst({
    where,
    select: { id: true, isLiked: true, likedAt: true },
  })
}
