import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function GET() {
  const startTime = Date.now()
  console.log("[/api/categories] Request started")

  const authStart = Date.now()
  const session = await auth()
  console.log("[/api/categories] Auth completed in", Date.now() - authStart, "ms")

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const queryStart = Date.now()
  const categories = await prisma.category.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: {
        select: {
          links: {
            where: {
              link: {
                userId: session.user.id,
              },
            },
          },
        },
      },
    },
  })
  console.log("[/api/categories] DB query completed in", Date.now() - queryStart, "ms")
  console.log("[/api/categories] Total request time:", Date.now() - startTime, "ms")

  return NextResponse.json({ categories })
}
