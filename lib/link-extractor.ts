import { JSDOM } from "jsdom"
import { createHash } from "crypto"

export const EXCLUDED_DOMAINS = [
  // Schema/metadata domains
  "schema.org",
  "ogp.me",
  "purl.org",
  "xmlns.com",
  "w3.org",
  "rdfs.org",

  // Social sharing/intent links
  "facebook.com/sharer",
  "facebook.com/share",
  "twitter.com/intent",
  "twitter.com/share",
  "linkedin.com/share",
  "pinterest.com/pin",
  "reddit.com/submit",
  "wa.me",
  "t.me/share",

  // App stores and maps
  "google.com/maps",
  "maps.google.com",
  "play.google.com",
  "apps.apple.com",
  "itunes.apple.com",

  // Email/tracking
  "mailchimp.com",
  "list-manage.com",
  "click.convertkit",
  "trk.klclick",
  "mandrillapp.com",
  "sendgrid.net",
  "unsubscribe",
  "manage-preferences",
  "email-preferences",

  // Analytics/tracking domains
  "doubleclick.net",
  "googleadservices.com",
  "googlesyndication.com",
  "google-analytics.com",
  "facebook.net",
  "connect.facebook.com",
  "ads.linkedin.com",

  // CDN/static resources
  "cloudflare.com",
  "cdn.jsdelivr.net",
  "unpkg.com",
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com",

  // Other non-content
  "gravatar.com",
  "wp.com/latex",
  "bit.ly",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "t.co",

  // Protocol handlers
  "mailto:",
  "tel:",
  "javascript:",
  "data:",
]

const EXCLUDED_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".zip", ".tar", ".gz", ".rar",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
]

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
    if (EXCLUDED_DOMAINS.some((d) => url.toLowerCase().includes(d))) {
      return false
    }

    // Check excluded extensions
    if (EXCLUDED_EXTENSIONS.some((ext) => parsed.pathname.toLowerCase().endsWith(ext))) {
      return false
    }

    return parsed.protocol === "http:" || parsed.protocol === "https:"
  } catch {
    return false
  }
}

function normalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url)

    // Remove tracking parameters
    const trackingParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "ref", "source", "fbclid", "gclid", "mc_cid", "mc_eid",
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
  return createHash("sha256").update(url).digest("hex")
}

export function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}
