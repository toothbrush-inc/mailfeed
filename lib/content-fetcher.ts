import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"

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

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      }
    }

    const html = await response.text()
    const dom = new JSDOM(html, { url })

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
