import { b } from "@/baml_client"

export interface AIParseResult {
  summary: string | null
  linkTags: string[]
  contentTags: string[]
  metadataTags: string[]
  aiCategory: string | null
  isPaywalled: boolean
  paywallType: string | null
}

export async function parseHtmlWithAI(
  url: string,
  rawHtml: string
): Promise<AIParseResult> {
  console.log(`[AI HTML Parser] Parsing ${url} with AI...`)

  const result = await b.IngestLink(url, "", rawHtml)

  // Map all tag types to string arrays
  const linkTags = result.tags?.map((tag) => String(tag)) || []
  const contentTags = result.contentTags?.map((tag) => String(tag)) || []
  const metadataTags = result.metadataTags?.map((tag) => String(tag)) || []

  // Primary category is the first content tag
  const aiCategory = contentTags[0] || null

  // Check for paywall indicators from metadataTags
  const isPaywalled =
    metadataTags.includes("PAYMENT_REQUIRED") ||
    metadataTags.includes("SUBSCRIPTION_REQUIRED") ||
    metadataTags.includes("LOGIN_REQUIRED")

  let paywallType: string | null = null
  if (metadataTags.includes("PAYMENT_REQUIRED")) {
    paywallType = "hard"
  } else if (metadataTags.includes("SUBSCRIPTION_REQUIRED")) {
    paywallType = "soft"
  } else if (metadataTags.includes("LOGIN_REQUIRED")) {
    paywallType = "registration"
  }

  console.log(`[AI HTML Parser] Completed parsing ${url}`)

  return {
    summary: result.summary || null,
    linkTags,
    contentTags,
    metadataTags,
    aiCategory,
    isPaywalled,
    paywallType,
  }
}
