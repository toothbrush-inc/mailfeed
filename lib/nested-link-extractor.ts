import { JSDOM } from "jsdom"
import { shouldUseOEmbed } from "./oembed-fetcher"
import { safeFetch } from "./safe-fetch"
import { classifyMediaUrl } from "./media"

// Domains to exclude from nested link extraction (social media, tracking, etc.)
// A link to a specific video on one of them is still kept: see isSkippedNestedUrl.
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
 * Whether a link found in a post is left out. Other posts and profiles on
 * social platforms are (a quoted tweet, a channel page), but a link to a
 * media item is the thing the post shares, so it is kept even when it is
 * on one of those platforms: a YouTube video, a TikTok, a reel.
 */
export function isSkippedNestedUrl(url: string): boolean {
  if (classifyMediaUrl(url)) return false
  return isExcludedNestedUrl(url) || shouldUseOEmbed(url)
}

/**
 * Resolve a shortened URL by following redirects
 */
async function resolveShortUrl(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const request = {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; MailFeed/1.0)",
      },
    }

    // Where the shortener itself points is the address the author shared.
    // For a media link that is the one to keep: following it further can
    // end on a consent or bot-check page instead of the video.
    const firstHop = await safeFetch(url, { ...request, redirect: "manual" })
    const location = firstHop.headers.get("location")
    const target = location ? new URL(location, url).toString() : null
    if (target && classifyMediaUrl(target)) {
      clearTimeout(timeout)
      console.log(`[Nested Link Extractor] Resolved ${url} -> ${target} (media)`)
      return target
    }

    const response = target ? await safeFetch(target, { ...request, redirect: "follow" }) : firstHop

    clearTimeout(timeout)

    // Return the final URL after redirects
    const finalUrl = target ? response.url : url

    // Check if the final URL is excluded
    if (isSkippedNestedUrl(finalUrl)) {
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
 * What to keep of one link found in a post: the link itself, where a
 * shortened link leads, or null for links that are left out.
 */
export async function resolveNestedUrl(href: string): Promise<string | null> {
  // Skip if it doesn't look like content
  if (!isContentUrl(href)) return null
  // Handle URL shorteners by resolving them
  if (isUrlShortener(href)) return resolveShortUrl(href)
  // Skip other social media posts and profiles (media links are kept)
  if (isSkippedNestedUrl(href)) return null
  return href
}

// Regex to find t.co links in text content
const TCO_REGEX = /https?:\/\/t\.co\/[a-zA-Z0-9]+/g

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
    // Links already looked at, so one that is both an <a> and in the text is resolved once
    const seen = new Set<string>()

    console.log(`[Nested Link Extractor] Processing HTML (${html.length} chars), ${links.length} <a> tags`)

    // t.co links may also sit in the text without an <a> tag
    const textContent = dom.window.document.body?.textContent || ""
    const hrefs = [
      ...links.map((link) => link.getAttribute("href")),
      ...(textContent.match(TCO_REGEX) || []),
    ]

    for (const href of hrefs) {
      if (!href || seen.has(href)) continue
      seen.add(href)

      const url = await resolveNestedUrl(href)
      if (url) {
        console.log(`[Nested Link Extractor] Added: ${url}${url === href ? "" : ` (from ${href})`}`)
        urls.add(url)
      } else {
        console.log(`[Nested Link Extractor] Skipped: ${href}`)
      }
    }

    console.log(`[Nested Link Extractor] Final URLs: ${Array.from(urls).join(", ") || "(none)"}`)
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
