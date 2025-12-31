import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"
import { shouldUseOEmbed, fetchOEmbed, extractTextFromOEmbed } from "./oembed-fetcher"
import { isMajorNewsSite, extractNewsMetadata } from "./news-extractor"

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

    // For major news sites, extract rich metadata using JSON-LD and enhanced OG extraction
    const isNewsSite = isMajorNewsSite(finalUrl)
    const newsMetadata = isNewsSite ? extractNewsMetadata(html, finalUrl) : null

    if (isNewsSite && newsMetadata) {
      console.log(`[Content Fetcher] Using news metadata extraction for: ${finalUrl}`)
    }

    // Extract Open Graph data (useful for paywalled sites)
    const ogData = extractOpenGraphData(dom.window.document)

    // Parse with Readability
    const reader = new Readability(dom.window.document)
    const article = reader.parse()

    if (!article) {
      // Readability failed, but we might have good metadata from news extraction or OG
      const hasNewsMetadata = newsMetadata?.title && newsMetadata?.description
      const hasOgMetadata = ogData.title && ogData.description

      if (hasNewsMetadata || hasOgMetadata) {
        const title = newsMetadata?.title || ogData.title
        const description = newsMetadata?.description || ogData.description
        const author = newsMetadata?.author || ogData.author

        console.log(`[Content Fetcher] Readability failed but using ${hasNewsMetadata ? "news" : "OG"} metadata for: ${url}`)
        return {
          success: true,
          title,
          excerpt: description,
          textContent: description,
          byline: author,
          siteName: newsMetadata?.siteName || ogData.siteName,
          imageUrl: newsMetadata?.image || ogData.image,
          wordCount: description?.split(/\s+/).filter(Boolean).length || 0,
          isPaywalled: newsMetadata?.isPaywalled || paywallCheck.isPaywalled,
          paywallType: paywallCheck.type,
          finalUrl,
          wasRedirected,
          rawHtml: html,
        }
      }

      return {
        success: false,
        isPaywalled: newsMetadata?.isPaywalled || paywallCheck.isPaywalled,
        paywallType: paywallCheck.type,
        error: "Could not parse article content",
        finalUrl,
        wasRedirected,
        rawHtml: html,
      }
    }

    // Use news metadata and OG data to supplement Readability results
    const imageUrl = newsMetadata?.image || ogData.image || undefined
    const siteName = newsMetadata?.siteName || ogData.siteName || article.siteName || undefined

    const textContent = article.textContent || ""
    const wordCount = textContent.split(/\s+/).filter(Boolean).length

    // For paywalled content with minimal text, prefer metadata description as excerpt
    const isPaywalled = newsMetadata?.isPaywalled || paywallCheck.isPaywalled
    const metaDescription = newsMetadata?.description || ogData.description
    const excerpt = (isPaywalled && metaDescription && wordCount < 200)
      ? metaDescription
      : (article.excerpt || metaDescription || undefined)

    // Prefer metadata title if Readability gave us a generic one
    const title = article.title || newsMetadata?.title || ogData.title || undefined

    // Prefer news metadata author over Readability byline
    const byline = newsMetadata?.author || article.byline || ogData.author || undefined

    return {
      success: true,
      title,
      content: article.content || undefined,
      textContent: textContent || undefined,
      excerpt,
      byline,
      siteName,
      imageUrl,
      wordCount,
      isPaywalled,
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

interface OpenGraphData {
  title?: string
  description?: string
  image?: string
  siteName?: string
  type?: string
  author?: string
}

function extractOpenGraphData(document: Document): OpenGraphData {
  const getMeta = (property: string): string | undefined => {
    const el = document.querySelector(`meta[property="${property}"]`) ||
               document.querySelector(`meta[name="${property}"]`)
    return el?.getAttribute("content") || undefined
  }

  return {
    title: getMeta("og:title") || document.querySelector("title")?.textContent || undefined,
    description: getMeta("og:description") || getMeta("description"),
    image: getMeta("og:image"),
    siteName: getMeta("og:site_name"),
    type: getMeta("og:type"),
    author: getMeta("author") || getMeta("article:author"),
  }
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
