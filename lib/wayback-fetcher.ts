import { JSDOM } from "jsdom"
import { Readability } from "@mozilla/readability"

export interface WaybackAvailability {
  available: boolean
  archivedUrl?: string
  timestamp?: string
}

export interface WaybackResult {
  success: boolean
  archivedUrl?: string
  timestamp?: string
  title?: string
  textContent?: string
  rawHtml?: string
  excerpt?: string
  byline?: string
  siteName?: string
  imageUrl?: string
  wordCount?: number
  error?: string
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

/**
 * Strip query parameters from a URL to improve Wayback Machine lookup
 */
function cleanUrlForArchive(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    // If URL parsing fails, try simple string split
    return url.split("?")[0]
  }
}

/**
 * Check if a URL has an archived version in the Wayback Machine
 */
export async function checkWaybackAvailability(url: string): Promise<WaybackAvailability> {
  const cleanUrl = cleanUrlForArchive(url)
  if (cleanUrl !== url) {
    console.log(`[Wayback] Cleaned URL: ${url} -> ${cleanUrl}`)
  }
  try {
    const apiUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(cleanUrl)}`
    console.log(`[Wayback] Checking availability: ${cleanUrl}`)

    const response = await fetch(apiUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      console.log(`[Wayback] API returned ${response.status}`)
      return { available: false }
    }

    const data = await response.json()
    console.log(`[Wayback] API response:`, JSON.stringify(data, null, 2))

    const snapshot = data?.archived_snapshots?.closest

    if (snapshot?.available && snapshot?.url) {
      console.log(`[Wayback] Found archived version from ${snapshot.timestamp}: ${snapshot.url}`)
      return {
        available: true,
        archivedUrl: snapshot.url,
        timestamp: snapshot.timestamp,
      }
    }

    console.log(`[Wayback] No archived version found. Snapshot:`, snapshot)
    return { available: false }
  } catch (error) {
    console.error(`[Wayback] Error checking availability:`, error)
    return { available: false }
  }
}

/**
 * Fetch and parse content from the Wayback Machine
 */
export async function fetchFromWayback(url: string): Promise<WaybackResult> {
  // First check if archived version exists
  const availability = await checkWaybackAvailability(url)

  if (!availability.available || !availability.archivedUrl) {
    return {
      success: false,
      error: "No archived version found in Wayback Machine",
    }
  }

  try {
    console.log(`[Wayback] Fetching archived content: ${availability.archivedUrl}`)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(availability.archivedUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    })

    clearTimeout(timeout)

    if (!response.ok) {
      return {
        success: false,
        error: `Wayback Machine returned ${response.status}: ${response.statusText}`,
      }
    }

    const html = await response.text()

    // Remove Wayback Machine toolbar/banner from HTML
    const cleanedHtml = removeWaybackBanner(html)

    const dom = new JSDOM(cleanedHtml, { url: availability.archivedUrl })

    // Extract Open Graph data
    const ogData = extractOpenGraphData(dom.window.document)

    // Parse with Readability
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article) {
      // Readability failed, try to use OG data
      if (ogData.title && ogData.description) {
        return {
          success: true,
          archivedUrl: availability.archivedUrl,
          timestamp: availability.timestamp,
          title: ogData.title,
          textContent: ogData.description,
          rawHtml: cleanedHtml,
          excerpt: ogData.description,
          siteName: ogData.siteName,
          imageUrl: ogData.image,
          wordCount: ogData.description.split(/\s+/).filter(Boolean).length,
        }
      }

      return {
        success: false,
        archivedUrl: availability.archivedUrl,
        error: "Could not parse archived content",
      }
    }

    const textContent = article.textContent || ""
    const wordCount = textContent.split(/\s+/).filter(Boolean).length

    console.log(`[Wayback] Successfully parsed archived content (${wordCount} words)`)

    return {
      success: true,
      archivedUrl: availability.archivedUrl,
      timestamp: availability.timestamp,
      title: article.title || ogData.title,
      textContent: textContent || undefined,
      rawHtml: cleanedHtml,
      excerpt: article.excerpt || ogData.description,
      byline: article.byline || undefined,
      siteName: article.siteName || ogData.siteName,
      imageUrl: ogData.image,
      wordCount,
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: "Request to Wayback Machine timed out",
      }
    }
    console.error(`[Wayback] Error fetching archived content:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * Remove the Wayback Machine banner/toolbar from archived HTML
 */
function removeWaybackBanner(html: string): string {
  // Remove the Wayback Machine toolbar comment and elements
  let cleaned = html

  // Remove the banner container
  cleaned = cleaned.replace(/<!-- BEGIN WAYBACK TOOLBAR INSERT -->[\s\S]*?<!-- END WAYBACK TOOLBAR INSERT -->/gi, "")

  // Remove any remaining wayback-specific elements
  cleaned = cleaned.replace(/<div[^>]*id="wm-ipp-base"[^>]*>[\s\S]*?<\/div>/gi, "")
  cleaned = cleaned.replace(/<script[^>]*src="[^"]*archive\.org[^"]*"[^>]*>[\s\S]*?<\/script>/gi, "")

  return cleaned
}

/**
 * Extract Open Graph metadata from document
 */
interface OpenGraphData {
  title?: string
  description?: string
  image?: string
  siteName?: string
}

function extractOpenGraphData(document: Document): OpenGraphData {
  const getMeta = (property: string): string | undefined => {
    const el =
      document.querySelector(`meta[property="${property}"]`) ||
      document.querySelector(`meta[name="${property}"]`)
    return el?.getAttribute("content") || undefined
  }

  return {
    title: getMeta("og:title") || document.querySelector("title")?.textContent || undefined,
    description: getMeta("og:description") || getMeta("description"),
    image: getMeta("og:image"),
    siteName: getMeta("og:site_name"),
  }
}
