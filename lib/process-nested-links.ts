import { prisma } from "./prisma"
import { extractNestedUrls, isSocialMediaLink } from "./nested-link-extractor"
import { hashUrl, extractDomain } from "./link-extractor"
import { fetchAndParseContent, estimateReadingTime } from "./content-fetcher"

// Domains to exclude for nested links (social media, images, etc.)
const EXCLUDED_NESTED_FINAL_DOMAINS = [
  "twitter.com",
  "x.com",
  "instagram.com",
  "tiktok.com",
  "facebook.com",
  "linkedin.com",
  "pic.twitter.com",
  "pbs.twimg.com",
  "video.twimg.com",
]

// Helper to check if a URL's domain should be excluded
const isExcludedUrl = (url: string) => {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace("www.", "").toLowerCase()
    const pathname = parsed.pathname.toLowerCase()

    // Allow X/Twitter article URLs (x.com/i/article/...)
    if ((hostname === "x.com" || hostname === "twitter.com") && pathname.startsWith("/i/article/")) {
      return false
    }

    return EXCLUDED_NESTED_FINAL_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    )
  } catch {
    return false
  }
}

interface ProcessNestedLinksResult {
  created: number
  fetched: number
  skipped: number
  errors: string[]
}

/**
 * Extract and process nested links from a parent social media link
 * Returns the URLs that were created as child links
 */
export async function processNestedLinks(
  parentLink: {
    id: string
    userId: string
    emailId: string | null
    rawHtml: string | null
    finalDomain: string | null
    domain: string | null
  }
): Promise<ProcessNestedLinksResult> {
  const result: ProcessNestedLinksResult = {
    created: 0,
    fetched: 0,
    skipped: 0,
    errors: [],
  }

  // Only process social media links
  const domain = parentLink.finalDomain || parentLink.domain
  if (!isSocialMediaLink(domain)) {
    return result
  }

  // Extract nested URLs from the rawHtml (resolves URL shorteners)
  const nestedUrls = await extractNestedUrls(parentLink.rawHtml)
  console.log(`[Nested Links] Found ${nestedUrls.length} nested URLs in ${domain} post`)

  if (nestedUrls.length === 0) {
    return result
  }

  for (const url of nestedUrls) {
    const urlHash = hashUrl(url)

    // Check for duplicate
    const existingLink = await prisma.link.findUnique({
      where: { userId_urlHash: { userId: parentLink.userId, urlHash } },
    })

    if (existingLink) {
      console.log(`[Nested Links] Skipping duplicate: ${url}`)
      result.skipped++
      continue
    }

    // Create child link record
    const childLink = await prisma.link.create({
      data: {
        userId: parentLink.userId,
        emailId: parentLink.emailId,
        parentLinkId: parentLink.id,
        url,
        urlHash,
        domain: extractDomain(url),
        fetchStatus: "PENDING",
      },
    })

    result.created++
    console.log(`[Nested Links] Created child link: ${url}`)

    // Fetch content for the child link
    try {
      await prisma.link.update({
        where: { id: childLink.id },
        data: { fetchStatus: "FETCHING" },
      })

      const content = await fetchAndParseContent(url)
      const rawHtml = content.rawHtml

      if (!content.success) {
        await prisma.link.update({
          where: { id: childLink.id },
          data: {
            fetchStatus: content.isPaywalled ? "PAYWALL_DETECTED" : "FAILED",
            fetchError: content.error,
            isPaywalled: content.isPaywalled || false,
            paywallType: content.paywallType,
            rawHtml: rawHtml,
            finalUrl: content.finalUrl,
            finalUrlHash: content.finalUrl ? hashUrl(content.finalUrl) : null,
            finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
            wasRedirected: content.wasRedirected || false,
            fetchedAt: new Date(),
          },
        })
        continue
      }

      // Check if final URL is excluded
      if (content.finalUrl && isExcludedUrl(content.finalUrl)) {
        console.log(`[Nested Links] Skipping - final URL excluded: ${url}`)
        await prisma.link.delete({ where: { id: childLink.id } })
        result.created--
        result.skipped++
        continue
      }

      // Check for duplicate by final URL
      const finalUrlHash = content.finalUrl ? hashUrl(content.finalUrl) : null
      if (finalUrlHash) {
        const existingByFinalUrl = await prisma.link.findFirst({
          where: {
            userId: parentLink.userId,
            finalUrlHash,
            id: { not: childLink.id },
          },
        })

        if (existingByFinalUrl) {
          console.log(`[Nested Links] Skipping - duplicate final URL: ${url}`)
          await prisma.link.delete({ where: { id: childLink.id } })
          result.created--
          result.skipped++
          continue
        }
      }

      await prisma.link.update({
        where: { id: childLink.id },
        data: {
          fetchStatus: "FETCHED",
          title: content.title,
          description: content.excerpt,
          imageUrl: content.imageUrl,
          contentText: content.textContent,
          rawHtml: rawHtml,
          wordCount: content.wordCount,
          readingTimeMin: content.wordCount ? estimateReadingTime(content.wordCount) : null,
          isPaywalled: content.isPaywalled || false,
          paywallType: content.paywallType,
          finalUrl: content.finalUrl,
          finalUrlHash,
          finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
          wasRedirected: content.wasRedirected || false,
          fetchedAt: new Date(),
        },
      })

      result.fetched++
    } catch (fetchError) {
      result.errors.push(`Failed to process nested link ${url}: ${fetchError}`)
      await prisma.link.update({
        where: { id: childLink.id },
        data: {
          fetchStatus: "FAILED",
          fetchError: fetchError instanceof Error ? fetchError.message : "Unknown error",
        },
      })
    }
  }

  return result
}
