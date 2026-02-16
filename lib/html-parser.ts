import { Readability } from "@mozilla/readability"
import { JSDOM } from "jsdom"

export interface ParsedContent {
  title: string | null
  description: string | null
  imageUrl: string | null
  contentText: string | null
  contentHtml: string | null
  wordCount: number
}

/**
 * Parse raw HTML through JSDOM + Readability + OG metadata extraction.
 * This is the "parse only" counterpart to fetchAndParseContent() — it takes
 * already-fetched HTML and extracts article content without making any network requests.
 */
export function parseRawHtml(rawHtml: string, url: string): ParsedContent {
  const dom = new JSDOM(rawHtml, { url })
  const document = dom.window.document

  // Extract Open Graph metadata
  const getMeta = (property: string): string | undefined => {
    const el =
      document.querySelector(`meta[property="${property}"]`) ||
      document.querySelector(`meta[name="${property}"]`)
    return el?.getAttribute("content") || undefined
  }

  const ogTitle = getMeta("og:title") || document.querySelector("title")?.textContent || undefined
  const ogDescription = getMeta("og:description") || getMeta("description")
  const ogImage = getMeta("og:image")

  // Parse with Readability
  const reader = new Readability(dom.window.document)
  const article = reader.parse()

  if (!article) {
    // Readability failed — fall back to OG metadata
    const fallbackText = ogDescription || null
    const fallbackWordCount = fallbackText
      ? fallbackText.split(/\s+/).filter(Boolean).length
      : 0

    return {
      title: ogTitle || null,
      description: ogDescription || null,
      imageUrl: ogImage || null,
      contentText: fallbackText,
      contentHtml: null,
      wordCount: fallbackWordCount,
    }
  }

  const textContent = article.textContent || ""
  const wordCount = textContent.split(/\s+/).filter(Boolean).length

  return {
    title: article.title || ogTitle || null,
    description: article.excerpt || ogDescription || null,
    imageUrl: ogImage || null,
    contentText: textContent || null,
    contentHtml: article.content || null,
    wordCount,
  }
}
