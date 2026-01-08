import { JSDOM } from "jsdom"
import { createHash } from "crypto"
import {
  EXCLUDED_DOMAINS,
  EXCLUDED_EXTENSIONS,
  isExcludedUrl,
  hasExcludedExtension,
} from "./constants/domains"

// Re-export for backwards compatibility
export { EXCLUDED_DOMAINS } from "./constants/domains"

export function extractLinks(htmlContent: string): string[] {
  const urls = new Set<string>()

  // Extract from href attributes using JSDOM
  try {
    const dom = new JSDOM(htmlContent)
    const anchors = dom.window.document.querySelectorAll("a[href]")

    anchors.forEach((anchor) => {
      const href = anchor.getAttribute("href")
      if (href && isValidUrl(href)) {
        const normalized = normalizeUrl(href)
        if (normalized) urls.add(normalized)
      }
    })
  } catch {
    // Fall back to regex if JSDOM fails
  }

  // Also extract plain text URLs
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi
  const textUrls = htmlContent.match(urlRegex) || []

  textUrls.forEach((url) => {
    // Clean up common trailing punctuation
    const cleanUrl = url.replace(/[.,;:!?)]+$/, "")
    if (isValidUrl(cleanUrl)) {
      const normalized = normalizeUrl(cleanUrl)
      if (normalized) urls.add(normalized)
    }
  })

  return Array.from(urls)
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)

    // Check excluded domains
    if (isExcludedUrl(url)) {
      return false
    }

    // Check excluded extensions
    if (hasExcludedExtension(parsed.pathname)) {
      return false
    }

    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

// Decode HTML entities in URLs (e.g., &amp; → &)
function decodeHtmlEntities(url: string): string {
  return url
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
}

export function normalizeUrl(url: string): string | null {
  try {
    // First, decode any HTML entities in the URL
    const decodedUrl = decodeHtmlEntities(url)

    const parsed = new URL(decodedUrl)

    // Remove tracking parameters (general + social media specific)
    const trackingParams = [
      // General tracking
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "ref", "source", "fbclid", "gclid", "mc_cid", "mc_eid",
      // Twitter/X tracking
      "s", "t",
      // Other social media tracking
      "igshid", // Instagram
      "share_id", "share_user_id", // TikTok
    ]
    trackingParams.forEach((p) => parsed.searchParams.delete(p))

    // Remove trailing slash for consistency
    let normalized = parsed.toString()
    if (normalized.endsWith("/") && parsed.pathname !== "/") {
      normalized = normalized.slice(0, -1)
    }

    return normalized
  } catch {
    return null
  }
}

export function hashUrl(url: string): string {
  // Normalize URL before hashing to ensure consistent deduplication
  const normalized = normalizeUrl(url) || url
  return createHash("sha256").update(normalized).digest("hex")
}

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
