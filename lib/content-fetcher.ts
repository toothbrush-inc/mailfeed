import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"
import { shouldUseOEmbed, fetchOEmbed, extractTextFromOEmbed } from "./oembed-fetcher"

interface FetchResult {
  success: boolean
  title?: string
  content?: string
  textContent?: string
  excerpt?: string
  byline?: string
  siteName?: string
  imageUrl?: string
  wordCount?: number
  isPaywalled?: boolean
  paywallType?: "hard" | "soft" | "registration"
  error?: string
  // Redirect tracking
  finalUrl?: string
  wasRedirected?: boolean
  // Raw HTML for AI fallback
  rawHtml?: string
}

const PAYWALL_INDICATORS = {
  hardPaywall: [
    "subscribe to read",
    "subscription required",
    "premium content",
    "members only",
    "subscribers only",
    "paywall",
    "premium article",
    "exclusive content",
  ],
  softPaywall: [
    "free articles remaining",
    "articles left this month",
    "register to continue",
    "sign up to read more",
    "create a free account",
    "limit reached",
    "monthly limit",
  ],
  registrationWall: [
    "sign in to continue",
    "log in to read",
    "create an account",
    "register for free",
    "login required",
  ],
}

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

export async function fetchAndParseContent(url: string): Promise<FetchResult> {
  try {
    // Try oEmbed first for known problematic sites (Twitter/X, Instagram, TikTok, YouTube)
    if (shouldUseOEmbed(url)) {
      console.log(`[Content Fetcher] Using oEmbed for: ${url}`)
      const oembedResult = await fetchOEmbed(url)

      if (oembedResult.success) {
        const textContent = extractTextFromOEmbed(oembedResult.html)
        const wordCount = textContent.split(/\s+/).filter(Boolean).length

        return {
          success: true,
          title: oembedResult.title,
          textContent,
          byline: oembedResult.authorName,
          siteName: oembedResult.providerName,
          imageUrl: oembedResult.thumbnailUrl,
          wordCount,
          finalUrl: url,
          wasRedirected: false,
          rawHtml: oembedResult.html,
        }
      }

      // If oEmbed fails, log and fall through to regular fetch
      console.log(`[Content Fetcher] oEmbed failed for ${url}, trying regular fetch: ${oembedResult.error}`)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    })

    clearTimeout(timeout)

    // Track final URL after redirects
    const finalUrl = response.url
    const wasRedirected = finalUrl !== url

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        finalUrl,
        wasRedirected,
      }
    }

    const html = await response.text()
    const dom = new JSDOM(html, { url: finalUrl })

    // Check for paywall
    const paywallCheck = detectPaywall(html)

    // Parse with Readability
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article) {
      return {
        success: false,
        isPaywalled: paywallCheck.isPaywalled,
        paywallType: paywallCheck.type,
        error: "Could not parse article content",
        finalUrl,
        wasRedirected,
        rawHtml: html,
      }
    }

    // Extract Open Graph image
    const ogImage = dom.window.document.querySelector('meta[property="og:image"]')
    const imageUrl = ogImage?.getAttribute("content") || undefined

    // Extract site name
    const ogSiteName = dom.window.document.querySelector('meta[property="og:site_name"]')
    const siteName = ogSiteName?.getAttribute("content") || article.siteName || undefined

    const textContent = article.textContent || ""
    const wordCount = textContent.split(/\s+/).filter(Boolean).length

    return {
      success: true,
      title: article.title || undefined,
      content: article.content || undefined,
      textContent: textContent || undefined,
      excerpt: article.excerpt || undefined,
      byline: article.byline || undefined,
      siteName,
      imageUrl,
      wordCount,
      isPaywalled: paywallCheck.isPaywalled,
      paywallType: paywallCheck.type,
      finalUrl,
      wasRedirected,
      rawHtml: html,
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        error: "Request timed out",
      }
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

function detectPaywall(html: string): {
  isPaywalled: boolean
  type?: "hard" | "soft" | "registration"
} {
  const lowerHtml = html.toLowerCase()

  // Check for hard paywall
  if (PAYWALL_INDICATORS.hardPaywall.some((indicator) => lowerHtml.includes(indicator))) {
    return { isPaywalled: true, type: "hard" }
  }

  // Check for soft paywall
  if (PAYWALL_INDICATORS.softPaywall.some((indicator) => lowerHtml.includes(indicator))) {
    return { isPaywalled: true, type: "soft" }
  }

  // Check for registration wall
  if (PAYWALL_INDICATORS.registrationWall.some((indicator) => lowerHtml.includes(indicator))) {
    return { isPaywalled: true, type: "registration" }
  }

  return { isPaywalled: false }
}

export function estimateReadingTime(wordCount: number): number {
  // Average reading speed: ~225 words per minute
  return Math.max(1, Math.ceil(wordCount / 225))
}

export function isPoorContent(content: FetchResult): boolean {
  // Readability failed entirely
  if (!content.success) return true

  // No text content extracted
  if (!content.textContent || content.textContent.trim().length === 0) return true

  // Very little content (less than 50 words)
  if (content.wordCount && content.wordCount < 50) return true

  return false
}
