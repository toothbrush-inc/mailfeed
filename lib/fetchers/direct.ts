import { fetchAndParseContent, isPoorContent } from "@/lib/content-fetcher"
import { isXUrl } from "@/lib/x-article-resolver"
import { registerFetcher, type ContentFetcher, type FetchResult } from "./index"

const directFetcher: ContentFetcher = {
  id: "direct",
  name: "Direct Fetch",
  description: "Fetches content directly from the URL using Readability",
  async fetch(url: string, options?: { timeoutMs?: number }): Promise<FetchResult> {
    const result = await fetchAndParseContent(url, options)

    // Skip poor-content check for tweet URLs — short text is expected
    if (result.success && isPoorContent(result) && !isXUrl(url)) {
      return {
        ...result,
        success: false,
        error: "Poor content quality (likely JS-rendered or empty)",
      }
    }

    return result
  },
}

registerFetcher(directFetcher)

export default directFetcher
