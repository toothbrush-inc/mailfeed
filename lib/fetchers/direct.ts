import { fetchAndParseContent } from "@/lib/content-fetcher"
import { registerFetcher, type ContentFetcher, type FetchResult } from "./index"

const directFetcher: ContentFetcher = {
  id: "direct",
  name: "Direct Fetch",
  description: "Fetches content directly from the URL using Readability",
  async fetch(url: string, options?: { timeoutMs?: number }): Promise<FetchResult> {
    return fetchAndParseContent(url, options)
  },
}

registerFetcher(directFetcher)

export default directFetcher
