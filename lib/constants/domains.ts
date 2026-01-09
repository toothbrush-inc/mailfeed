/**
 * Centralized domain constants and helper functions
 * Used across sync, link processing, and filtering
 */

// Domains to exclude from link extraction and processing
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
] as const

// File extensions to exclude
export const EXCLUDED_EXTENSIONS = [
  ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".ico",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx",
  ".zip", ".tar", ".gz", ".rar",
  ".mp3", ".mp4", ".wav", ".avi", ".mov",
] as const

// Social media domains that may contain nested links
export const SOCIAL_MEDIA_DOMAINS = [
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "threads.net",
  "facebook.com",
] as const

// Pre-built Set for O(1) lookups (used for exact domain matching)
const socialMediaDomainSet: Set<string> = new Set(SOCIAL_MEDIA_DOMAINS)

/**
 * Check if a URL should be excluded from processing
 * Uses substring matching for flexibility (handles paths like facebook.com/sharer)
 */
export function isExcludedUrl(url: string): boolean {
  const lowerUrl = url.toLowerCase()
  return EXCLUDED_DOMAINS.some((d) => lowerUrl.includes(d))
}

/**
 * Check if a file extension should be excluded
 */
export function hasExcludedExtension(pathname: string): boolean {
  const lowerPath = pathname.toLowerCase()
  return EXCLUDED_EXTENSIONS.some((ext) => lowerPath.endsWith(ext))
}

/**
 * Check if a domain is a social media platform that may contain nested links
 */
export function isSocialMediaDomain(domain: string | null): boolean {
  if (!domain) return false
  const normalizedDomain = domain.replace("www.", "").toLowerCase()
  return SOCIAL_MEDIA_DOMAINS.some((d) => normalizedDomain.includes(d))
}

/**
 * Check if a domain exactly matches a social media domain (stricter check)
 */
export function isExactSocialMediaDomain(domain: string | null): boolean {
  if (!domain) return false
  const normalizedDomain = domain.replace("www.", "").toLowerCase()
  return socialMediaDomainSet.has(normalizedDomain)
}
