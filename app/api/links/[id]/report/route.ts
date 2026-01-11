import { NextRequest, NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: linkId } = await params

  // Verify the link exists and belongs to the user
  const link = await prisma.link.findUnique({
    where: { id: linkId },
    select: { id: true, userId: true, url: true, fetchStatus: true },
  })

  if (!link) {
    return NextResponse.json({ error: "Link not found" }, { status: 404 })
  }

  if (link.userId !== session.user.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  // Parse the optional reason from request body
  let reason: string | null = null
  try {
    const body = await request.json()
    reason = body.reason || null
  } catch {
    // No body or invalid JSON is fine - reason is optional
  }

  // Check if user already reported this link
  const existingReport = await prisma.linkReport.findFirst({
    where: {
      linkId,
      userId: session.user.id,
    },
  })

  if (existingReport) {
    // Update the existing report with new reason if provided
    const updated = await prisma.linkReport.update({
      where: { id: existingReport.id },
      data: {
        reason: reason || existingReport.reason,
        createdAt: new Date(), // Refresh the timestamp
      },
    })
    return NextResponse.json({
      success: true,
      reportId: updated.id,
      message: "Report updated",
    })
  }

  // Create a new report
  const report = await prisma.linkReport.create({
    data: {
      linkId,
      userId: session.user.id,
      reason,
    },
  })

  return NextResponse.json({
    success: true,
    reportId: report.id,
    message: "Report submitted",
  })
}

// Get report status for a link
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id: linkId } = await params

  const report = await prisma.linkReport.findFirst({
    where: {
      linkId,
      userId: session.user.id,
    },
    select: {
      id: true,
      reason: true,
      createdAt: true,
    },
  })

  return NextResponse.json({
    reported: !!report,
    report,
  })
}
