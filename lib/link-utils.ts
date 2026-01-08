/**
 * Link validation and utility functions
 * Used for duplicate detection and URL validation during link processing
 */

import { prisma } from "./prisma"
import { hashUrl, extractDomain } from "./link-extractor"
import { isExcludedUrl } from "./constants/domains"

export { hashUrl, extractDomain } from "./link-extractor"
export { isExcludedUrl } from "./constants/domains"

/**
 * Check if a URL should be excluded from processing
 * Checks both original and final URLs
 */
export function shouldExcludeUrl(
  url: string,
  finalUrl?: string | null
): { excluded: boolean; reason?: string } {
  if (isExcludedUrl(url)) {
    return { excluded: true, reason: "Original URL in excluded domains" }
  }

  if (finalUrl && isExcludedUrl(finalUrl)) {
    return { excluded: true, reason: "Final URL in excluded domains" }
  }

  return { excluded: false }
}

/**
 * Build final URL hash from a URL
 */
export function buildFinalUrlHash(finalUrl: string | null): string | null {
  return finalUrl ? hashUrl(finalUrl) : null
}

/**
 * Check for duplicate link by URL hash
 */
export async function checkDuplicateByUrlHash(
  userId: string,
  urlHash: string
): Promise<boolean> {
  const existing = await prisma.link.findUnique({
    where: {
      userId_urlHash: { userId, urlHash },
    },
    select: { id: true },
  })

  return !!existing
}

/**
 * Check for duplicate link by final URL hash (after redirects resolved)
 * Returns the existing link if found
 */
export async function checkDuplicateByFinalUrl(
  userId: string,
  finalUrlHash: string,
  excludeId?: string
): Promise<{ id: string } | null> {
  const where: Record<string, unknown> = {
    userId,
    finalUrlHash,
  }

  if (excludeId) {
    where.id = { not: excludeId }
  }

  return prisma.link.findFirst({
    where,
    select: { id: true },
  })
}

/**
 * Validate a URL for link extraction
 * Returns validation result with reason if invalid
 */
export function validateUrl(url: string): { valid: boolean; reason?: string } {
  try {
    const parsed = new URL(url)

    // Must be http or https
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { valid: false, reason: "Invalid protocol" }
    }

    // Check against excluded domains
    if (isExcludedUrl(url)) {
      return { valid: false, reason: "Excluded domain" }
    }

    return { valid: true }
  } catch {
    return { valid: false, reason: "Invalid URL format" }
  }
}

/**
 * Extract and validate URL metadata
 */
export function extractUrlMetadata(url: string, finalUrl?: string | null) {
  return {
    domain: extractDomain(url),
    urlHash: hashUrl(url),
    finalUrl: finalUrl || null,
    finalUrlHash: buildFinalUrlHash(finalUrl || null),
    finalDomain: finalUrl ? extractDomain(finalUrl) : null,
  }
}

/**
 * Check if a link processing result should skip further processing
 * Used after content fetch to determine if link should be deleted
 */
export async function validateFetchedLink(
  linkId: string,
  userId: string,
  finalUrl: string | null
): Promise<{
  valid: boolean
  reason?: string
  action?: "delete" | "skip"
}> {
  // Check if final URL is excluded
  if (finalUrl && isExcludedUrl(finalUrl)) {
    return {
      valid: false,
      reason: "Final URL in excluded domains",
      action: "delete",
    }
  }

  // Check for duplicate by final URL
  const finalUrlHash = buildFinalUrlHash(finalUrl)
  if (finalUrlHash) {
    const duplicate = await checkDuplicateByFinalUrl(userId, finalUrlHash, linkId)
    if (duplicate) {
      return {
        valid: false,
        reason: "Duplicate final URL",
        action: "delete",
      }
    }
  }

  return { valid: true }
}
