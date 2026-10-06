import { fetchAndParseContent, isPoorContent } from "@/lib/content-fetcher"
import { isXUrl } from "@/lib/x-article-resolver"
import { classifyMediaUrl } from "@/lib/media"
import { registerFetcher, type ContentFetcher, type FetchResult } from "./index"

const directFetcher: ContentFetcher = {
  id: "direct",
  name: "Direct Fetch",
  description: "Fetches content directly from the URL using Readability",
  async fetch(url: string, options?: { timeoutMs?: number }): Promise<FetchResult> {
    const result = await fetchAndParseContent(url, options)

    // Skip poor-content check for tweet URLs — short text is expected.
    // Same for a video page (YouTube's oEmbed is a player with no text at
    // all): the title and thumbnail are the content, and failing it here
    // would drop them and send the link to Wayback for nothing.
    const textNotExpected = isXUrl(url) || classifyMediaUrl(url) === "video"
    if (result.success && isPoorContent(result) && !textNotExpected) {
      return {
        ...result,
        success: false,
        insufficientContent: true,
        error: "Poor content quality (likely JS-rendered or empty)",
      }
    }

    return result
  },
}

registerFetcher(directFetcher)

export default directFetcher
