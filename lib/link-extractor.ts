import { JSDOM } from "jsdom"
import { createHash } from "crypto"
import {
  EXCLUDED_DOMAINS,
  EXCLUDED_EXTENSIONS,
  isExcludedUrl,
  hasExcludedExtension,
} from "./constants/domains"

import { normalizeUrl } from "./clean-url"

// Re-export for backwards compatibility
export { EXCLUDED_DOMAINS } from "./constants/domains"
// The clean form of an address lives in lib/clean-url.ts, free of Node dependencies
export { normalizeUrl, cleanUrl } from "./clean-url"

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
