/**
 * Link status transitions and utilities
 * Centralizes all link status update logic
 */

import { prisma } from "./prisma"
import { linkLogger } from "./logger"

/**
 * Valid link fetch statuses
 */
export type LinkFetchStatus =
  | "PENDING"
  | "FETCHING"
  | "FETCHED"
  | "ANALYZING"
  | "COMPLETED"
  | "FAILED"
  | "PAYWALL_DETECTED"

/**
 * Update link status with optional additional data
 */
export async function updateLinkStatus(
  linkId: string,
  status: LinkFetchStatus,
  data?: Record<string, unknown>
) {
  linkLogger.debug(`Status transition: ${status}`, { linkId })

  return prisma.link.update({
    where: { id: linkId },
    data: {
      fetchStatus: status,
      ...data,
    },
  })
}

/**
 * Mark link as fetching
 */
export async function markFetching(linkId: string) {
  return updateLinkStatus(linkId, "FETCHING")
}

/**
 * Mark link as fetched with content data
 */
export async function markFetched(
  linkId: string,
  data: {
    title?: string | null
    description?: string | null
    imageUrl?: string | null
    contentText?: string | null
    rawHtml?: string | null
    wordCount?: number | null
    readingTimeMin?: number | null
    isPaywalled?: boolean
    paywallType?: string | null
    finalUrl?: string | null
    finalUrlHash?: string | null
    finalDomain?: string | null
    wasRedirected?: boolean
  }
) {
  return updateLinkStatus(linkId, "FETCHED", {
    ...data,
    fetchError: null,
    fetchedAt: new Date(),
  })
}

/**
 * Mark link as analyzing
 */
export async function markAnalyzing(linkId: string) {
  return updateLinkStatus(linkId, "ANALYZING")
}

/**
 * Mark link as completed with AI analysis data
 */
export async function markCompleted(
  linkId: string,
  data: {
    aiSummary?: string | null
    aiKeyPoints?: string[]
    aiCategory?: string | null
    aiTags?: string[]
    worthinessScore?: number | null
    uniquenessScore?: number | null
    isHighlighted?: boolean
    highlightReason?: string | null
    linkTags?: string[]
    contentTags?: string[]
    metadataTags?: string[]
  }
) {
  return updateLinkStatus(linkId, "COMPLETED", {
    ...data,
    analyzedAt: new Date(),
  })
}

/**
 * Mark link as failed
 */
export async function markFailed(
  linkId: string,
  error: string,
  data?: {
    rawHtml?: string | null
    finalUrl?: string | null
    finalUrlHash?: string | null
    finalDomain?: string | null
    wasRedirected?: boolean
  }
) {
  linkLogger.warn("Link fetch failed", { linkId, error })

  return updateLinkStatus(linkId, "FAILED", {
    fetchError: error,
    fetchedAt: new Date(),
    ...data,
  })
}

/**
 * Mark link as paywall detected
 */
export async function markPaywallDetected(
  linkId: string,
  data: {
    paywallType?: string | null
    fetchError?: string | null
    rawHtml?: string | null
    finalUrl?: string | null
    finalUrlHash?: string | null
    finalDomain?: string | null
    wasRedirected?: boolean
  }
) {
  linkLogger.info("Paywall detected", { linkId })

  return updateLinkStatus(linkId, "PAYWALL_DETECTED", {
    isPaywalled: true,
    fetchedAt: new Date(),
    ...data,
  })
}

/**
 * Revert link to fetched status (used when AI analysis fails)
 */
export async function revertToFetched(linkId: string) {
  linkLogger.warn("Reverting to FETCHED status", { linkId })
  return updateLinkStatus(linkId, "FETCHED")
}

/**
 * Delete a link (used when link should be excluded/deduplicated)
 */
export async function deleteLink(linkId: string, reason: string) {
  linkLogger.info(`Deleting link: ${reason}`, { linkId })
  return prisma.link.delete({ where: { id: linkId } })
}
