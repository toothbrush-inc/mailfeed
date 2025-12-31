import { JSDOM } from "jsdom"

export interface OEmbedResult {
  success: boolean
  title?: string
  authorName?: string
  authorUrl?: string
  html?: string
  thumbnailUrl?: string
  providerName?: string
  error?: string
}

// oEmbed endpoints for known problematic sites
const OEMBED_ENDPOINTS: Record<string, string> = {
  "twitter.com": "https://publish.twitter.com/oembed",
  "x.com": "https://publish.twitter.com/oembed",
  "instagram.com": "https://api.instagram.com/oembed",
  "tiktok.com": "https://www.tiktok.com/oembed",
  "youtube.com": "https://www.youtube.com/oembed",
  "youtu.be": "https://www.youtube.com/oembed",
}

// Domains that should use oEmbed instead of regular fetch
const OEMBED_DOMAINS = [
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
]

/**
 * Check if a URL should use oEmbed instead of regular fetch
 */
export function shouldUseOEmbed(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace("www.", "")
    const pathname = parsed.pathname.toLowerCase()

    // X/Twitter article URLs should NOT use oEmbed - fetch them normally
    if ((hostname.includes("x.com") || hostname.includes("twitter.com")) && pathname.startsWith("/i/article/")) {
      return false
    }

    return OEMBED_DOMAINS.some((d) => hostname.includes(d))
  } catch {
    return false
  }
}

/**
 * Get the oEmbed endpoint for a URL
 */
export function getOEmbedEndpoint(url: string): string | null {
  try {
    const hostname = new URL(url).hostname.replace("www.", "")
    for (const [domain, endpoint] of Object.entries(OEMBED_ENDPOINTS)) {
      if (hostname.includes(domain)) {
        return endpoint
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Extract readable text from oEmbed HTML (usually a blockquote)
 */
export function extractTextFromOEmbed(html: string | undefined): string {
  if (!html) return ""
  try {
    const dom = new JSDOM(html)
    return dom.window.document.body.textContent?.trim() || ""
  } catch {
    // Fallback: strip HTML tags with regex
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  }
}

/**
 * Fetch content using oEmbed API
 */
export async function fetchOEmbed(url: string): Promise<OEmbedResult> {
  const endpoint = getOEmbedEndpoint(url)

  if (!endpoint) {
    return {
      success: false,
      error: "No oEmbed endpoint for this URL",
    }
  }

  try {
    const oembedUrl = `${endpoint}?url=${encodeURIComponent(url)}&format=json`
    console.log(`[oEmbed] Fetching: ${oembedUrl}`)

    const response = await fetch(oembedUrl, {
      headers: {
        Accept: "application/json",
      },
    })

    if (!response.ok) {
      return {
        success: false,
        error: `oEmbed API returned ${response.status}: ${response.statusText}`,
      }
    }

    const data = await response.json()

    // Extract title from HTML if not provided directly
    // Twitter/X oEmbed doesn't have a title field, but the tweet text is in the html
    let title = data.title
    if (!title && data.html) {
      const textContent = extractTextFromOEmbed(data.html)
      // Use first 100 chars as title
      title = textContent.slice(0, 100) + (textContent.length > 100 ? "..." : "")
    }

    console.log(`[oEmbed] Success for ${url}:`, {
      title: title?.slice(0, 50),
      author: data.author_name,
      provider: data.provider_name,
    })

    return {
      success: true,
      title,
      authorName: data.author_name,
      authorUrl: data.author_url,
      html: data.html,
      thumbnailUrl: data.thumbnail_url,
      providerName: data.provider_name,
    }
  } catch (error) {
    console.error(`[oEmbed] Error fetching ${url}:`, error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
