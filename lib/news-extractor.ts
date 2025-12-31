import { JSDOM } from "jsdom"

export interface NewsMetadata {
  title?: string
  description?: string
  excerpt?: string
  author?: string
  authors?: string[]
  publishedAt?: string
  modifiedAt?: string
  section?: string
  tags?: string[]
  image?: string
  siteName?: string
  wordCount?: number
  isPaywalled: boolean
  isPremium?: boolean
}

// Major news sites that commonly have paywalls but good metadata
const MAJOR_NEWS_DOMAINS = [
  "nytimes.com",
  "latimes.com",
  "wsj.com",
  "washingtonpost.com",
  "theatlantic.com",
  "bloomberg.com",
  "ft.com",
  "economist.com",
  "newyorker.com",
  "wired.com",
  "vanityfair.com",
  "politico.com",
  "reuters.com",
  "apnews.com",
  "bbc.com",
  "bbc.co.uk",
  "theguardian.com",
  "cnn.com",
  "nbcnews.com",
  "abcnews.go.com",
  "cbsnews.com",
  "foxnews.com",
  "usatoday.com",
  "time.com",
  "forbes.com",
  "businessinsider.com",
  "techcrunch.com",
  "theverge.com",
  "arstechnica.com",
  "engadget.com",
  "vice.com",
  "vox.com",
  "axios.com",
  "thehill.com",
  "huffpost.com",
  "dailybeast.com",
  "salon.com",
  "slate.com",
  "thedailybeast.com",
]

/**
 * Check if URL is from a major news site
 */
export function isMajorNewsSite(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace("www.", "").toLowerCase()
    return MAJOR_NEWS_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))
  } catch {
    return false
  }
}

/**
 * Extract rich metadata from a news article HTML
 * Uses OpenGraph, Twitter Cards, JSON-LD, and standard meta tags
 */
export function extractNewsMetadata(html: string, url: string): NewsMetadata {
  const dom = new JSDOM(html, { url })
  const document = dom.window.document

  // Helper to get meta content
  const getMeta = (selectors: string[]): string | undefined => {
    for (const selector of selectors) {
      const el = document.querySelector(selector)
      const content = el?.getAttribute("content") || el?.textContent
      if (content?.trim()) return content.trim()
    }
    return undefined
  }

  // Extract JSON-LD structured data
  const jsonLd = extractJsonLd(document)

  // Get title (prioritize JSON-LD, then OG, then standard)
  const title = jsonLd?.headline ||
    jsonLd?.name ||
    getMeta([
      'meta[property="og:title"]',
      'meta[name="twitter:title"]',
      'meta[name="title"]',
    ]) ||
    document.querySelector("h1")?.textContent?.trim() ||
    document.querySelector("title")?.textContent?.trim()

  // Get description
  const description = jsonLd?.description ||
    getMeta([
      'meta[property="og:description"]',
      'meta[name="twitter:description"]',
      'meta[name="description"]',
    ])

  // Get author(s)
  const authors = extractAuthors(document, jsonLd)
  const author = authors.length > 0 ? authors.join(", ") : undefined

  // Get publish date
  const publishedAt = jsonLd?.datePublished ||
    getMeta([
      'meta[property="article:published_time"]',
      'meta[name="article:published_time"]',
      'meta[name="pubdate"]',
      'meta[name="publish-date"]',
      'meta[name="date"]',
      'time[datetime]',
    ]) ||
    document.querySelector("time")?.getAttribute("datetime")

  // Get modified date
  const modifiedAt = jsonLd?.dateModified ||
    getMeta([
      'meta[property="article:modified_time"]',
      'meta[name="article:modified_time"]',
      'meta[name="last-modified"]',
    ])

  // Get section/category
  const section = jsonLd?.articleSection ||
    getMeta([
      'meta[property="article:section"]',
      'meta[name="article:section"]',
      'meta[name="section"]',
    ])

  // Get tags/keywords
  const tags = extractTags(document, jsonLd)

  // Get image
  const image = jsonLd?.image?.url ||
    jsonLd?.image ||
    getMeta([
      'meta[property="og:image"]',
      'meta[name="twitter:image"]',
      'meta[name="thumbnail"]',
    ])

  // Get site name
  const siteName = jsonLd?.publisher?.name ||
    getMeta([
      'meta[property="og:site_name"]',
      'meta[name="application-name"]',
    ])

  // Get word count from JSON-LD if available
  const wordCount = jsonLd?.wordCount

  // Check for paywall indicators
  const isPaywalled = checkPaywallIndicators(document, jsonLd)
  const isPremium = jsonLd?.isAccessibleForFree === false || jsonLd?.isAccessibleForFree === "False"

  return {
    title,
    description,
    excerpt: description,
    author,
    authors: authors.length > 0 ? authors : undefined,
    publishedAt,
    modifiedAt,
    section,
    tags: tags.length > 0 ? tags : undefined,
    image: typeof image === "string" ? image : undefined,
    siteName,
    wordCount,
    isPaywalled,
    isPremium,
  }
}

/**
 * Extract JSON-LD structured data from the document
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractJsonLd(document: Document): any | null {
  const scripts = document.querySelectorAll('script[type="application/ld+json"]')

  for (const script of scripts) {
    try {
      const data = JSON.parse(script.textContent || "")

      // Handle @graph arrays (common in WordPress)
      if (data["@graph"]) {
        const article = data["@graph"].find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (item: any) =>
            item["@type"] === "NewsArticle" ||
            item["@type"] === "Article" ||
            item["@type"] === "WebPage"
        )
        if (article) return article
      }

      // Handle direct article type
      if (
        data["@type"] === "NewsArticle" ||
        data["@type"] === "Article" ||
        data["@type"] === "WebPage" ||
        data["@type"] === "ReportageNewsArticle"
      ) {
        return data
      }

      // Handle arrays
      if (Array.isArray(data)) {
        const article = data.find(
          (item) =>
            item["@type"] === "NewsArticle" ||
            item["@type"] === "Article" ||
            item["@type"] === "WebPage"
        )
        if (article) return article
      }
    } catch {
      // Invalid JSON, skip
    }
  }

  return null
}

/**
 * Extract author names from various sources
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAuthors(document: Document, jsonLd: any): string[] {
  const authors: string[] = []

  // From JSON-LD
  if (jsonLd?.author) {
    if (Array.isArray(jsonLd.author)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      jsonLd.author.forEach((a: any) => {
        if (typeof a === "string") authors.push(a)
        else if (a.name) authors.push(a.name)
      })
    } else if (typeof jsonLd.author === "string") {
      authors.push(jsonLd.author)
    } else if (jsonLd.author.name) {
      authors.push(jsonLd.author.name)
    }
  }

  if (authors.length > 0) return authors

  // From meta tags
  const authorMeta = document.querySelector('meta[name="author"]')?.getAttribute("content")
  if (authorMeta) {
    // Split by common separators
    const parsed = authorMeta.split(/,|and|&/).map((a) => a.trim()).filter(Boolean)
    if (parsed.length > 0) return parsed
  }

  // From article:author meta
  const articleAuthor = document.querySelector('meta[property="article:author"]')?.getAttribute("content")
  if (articleAuthor) {
    authors.push(articleAuthor)
  }

  return authors
}

/**
 * Extract tags/keywords from various sources
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractTags(document: Document, jsonLd: any): string[] {
  const tags: string[] = []

  // From JSON-LD
  if (jsonLd?.keywords) {
    if (Array.isArray(jsonLd.keywords)) {
      tags.push(...jsonLd.keywords)
    } else if (typeof jsonLd.keywords === "string") {
      tags.push(...jsonLd.keywords.split(",").map((t: string) => t.trim()))
    }
  }

  if (tags.length > 0) return tags

  // From meta keywords
  const keywordsMeta = document.querySelector('meta[name="keywords"]')?.getAttribute("content")
  if (keywordsMeta) {
    tags.push(...keywordsMeta.split(",").map((t) => t.trim()).filter(Boolean))
  }

  // From article:tag meta tags
  const tagMetas = document.querySelectorAll('meta[property="article:tag"]')
  tagMetas.forEach((meta) => {
    const tag = meta.getAttribute("content")
    if (tag) tags.push(tag)
  })

  return [...new Set(tags)] // Dedupe
}

/**
 * Check for paywall indicators in the document
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function checkPaywallIndicators(document: Document, jsonLd: any): boolean {
  // Check JSON-LD isAccessibleForFree
  if (jsonLd?.isAccessibleForFree === false || jsonLd?.isAccessibleForFree === "False") {
    return true
  }

  // Check for paywall-related classes/elements
  const paywallSelectors = [
    '[class*="paywall"]',
    '[class*="subscriber"]',
    '[id*="paywall"]',
    '[data-paywall]',
    ".piano-offer",
    ".pw-wall",
    ".article-barrier",
  ]

  for (const selector of paywallSelectors) {
    if (document.querySelector(selector)) {
      return true
    }
  }

  return false
}

/**
 * Get a formatted summary of the news metadata
 */
export function formatNewsMetadataSummary(metadata: NewsMetadata): string {
  const parts: string[] = []

  if (metadata.title) {
    parts.push(metadata.title)
  }

  if (metadata.author) {
    parts.push(`By ${metadata.author}`)
  }

  if (metadata.publishedAt) {
    try {
      const date = new Date(metadata.publishedAt)
      parts.push(`Published ${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`)
    } catch {
      // Invalid date, skip
    }
  }

  if (metadata.section) {
    parts.push(`Section: ${metadata.section}`)
  }

  if (metadata.description) {
    parts.push(metadata.description)
  }

  return parts.join("\n\n")
}
