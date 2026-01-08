import { JSDOM } from "jsdom"
import { shouldUseOEmbed } from "./oembed-fetcher"

// Domains to exclude from nested link extraction (social media, tracking, etc.)
const EXCLUDED_NESTED_DOMAINS = [
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "fb.com",
  "linkedin.com",
  "pic.twitter.com",
]

// URL shorteners that need to be resolved
const URL_SHORTENERS = [
  "t.co",
  "bit.ly",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "tinyurl.com",
]

/**
 * Check if a URL is a shortener that needs resolving
 */
function isUrlShortener(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace("www.", "").toLowerCase()
    return URL_SHORTENERS.some((d) => hostname === d || hostname.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/**
 * Check if a URL should be excluded from nested extraction
 */
function isExcludedNestedUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace("www.", "").toLowerCase()
    const pathname = parsed.pathname.toLowerCase()

    // Allow X/Twitter article URLs (x.com/i/article/...)
    if ((hostname === "x.com" || hostname === "twitter.com") && pathname.startsWith("/i/article/")) {
      return false
    }

    return EXCLUDED_NESTED_DOMAINS.some((d) => hostname.includes(d))
  } catch {
    return true
  }
}

/**
 * Resolve a shortened URL by following redirects
 */
async function resolveShortUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MailFeed/1.0)",
      },
    })

    clearTimeout(timeout)

    // Return the final URL after redirects
    const finalUrl = response.url

    // Check if the final URL is excluded
    if (isExcludedNestedUrl(finalUrl)) {
      console.log(`[Nested Link Extractor] Resolved ${url} -> ${finalUrl} (excluded)`)
      return null
    }

    console.log(`[Nested Link Extractor] Resolved ${url} -> ${finalUrl}`)
    return finalUrl
  } catch (error) {
    console.error(`[Nested Link Extractor] Failed to resolve ${url}:`, error)
    return null
  }
}

/**
 * Check if a URL looks like a real article/content link
 */
function isContentUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    // Must have a path beyond just /
    if (parsed.pathname === "/" || parsed.pathname === "") return false
    // Must be http/https
    if (!["http:", "https:"].includes(parsed.protocol)) return false
    return true
  } catch {
    return false
  }
}

/**
 * Extract URLs from oEmbed HTML content (e.g., tweet blockquotes)
 * Returns URLs that appear to be links to external content
 * Resolves URL shorteners like t.co to their final destinations
 */
export async function extractNestedUrls(html: string | undefined | null): Promise<string[]> {
  if (!html) return []

  try {
    const dom = new JSDOM(html)
    const links = Array.from(dom.window.document.querySelectorAll("a[href]"))
    const urls = new Set<string>()

    for (const link of links) {
      const href = link.getAttribute("href")
      if (!href) continue

      // Skip if it doesn't look like content
      if (!isContentUrl(href)) continue

      // Handle URL shorteners by resolving them
      if (isUrlShortener(href)) {
        const resolvedUrl = await resolveShortUrl(href)
        if (resolvedUrl && !shouldUseOEmbed(resolvedUrl)) {
          urls.add(resolvedUrl)
        }
        continue
      }

      // Skip if it's a social media URL
      if (isExcludedNestedUrl(href)) continue

      // Skip if it would use oEmbed (social media post)
      if (shouldUseOEmbed(href)) continue

      urls.add(href)
    }

    return Array.from(urls)
  } catch (error) {
    console.error("[Nested Link Extractor] Error parsing HTML:", error)
    return []
  }
}

/**
 * Check if a link is from a social media platform that might contain nested links
 * Re-exported from constants for backwards compatibility
 */
export { isSocialMediaDomain as isSocialMediaLink } from "./constants/domains"
