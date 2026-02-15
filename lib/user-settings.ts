import { prisma } from "@/lib/prisma"
import { resolveSettings, type ResolvedSettings, type UserSettings } from "@/lib/settings"

export async function getUserSettings(userId: string): Promise<ResolvedSettings> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { settings: true },
  })

  return resolveSettings(user?.settings as UserSettings | null)
}
