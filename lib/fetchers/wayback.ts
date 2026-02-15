import { fetchFromWayback } from "@/lib/wayback-fetcher"
import { registerFetcher, type ContentFetcher, type FetchResult } from "./index"

const waybackFetcher: ContentFetcher = {
  id: "wayback",
  name: "Wayback Machine",
  description: "Fetches archived content from the Internet Archive's Wayback Machine",
  async fetch(url: string): Promise<FetchResult> {
    const result = await fetchFromWayback(url)

    if (!result.success) {
      return {
        success: false,
        error: result.error || "Not found in Wayback Machine",
      }
    }

    return {
      success: true,
      title: result.title,
      textContent: result.textContent,
      content: result.contentHtml,
      rawHtml: result.rawHtml,
      excerpt: result.excerpt,
      byline: result.byline,
      siteName: result.siteName,
      imageUrl: result.imageUrl,
      wordCount: result.wordCount,
      finalUrl: result.archivedUrl,
      wasRedirected: false,
    }
  },
}

registerFetcher(waybackFetcher)

export default waybackFetcher
