import { prisma } from "./prisma"
import { hashUrl, extractDomain } from "./link-extractor"
import { estimateReadingTime } from "./content-fetcher"
import { fetchWithFallbackChain } from "./fetchers"
import { recordFetchAttempts, generateOperationId } from "./fetch-attempts"
import { triggerAutoAnalysisAndEmbedding } from "./ai-triggers"
import { classifyMediaUrl } from "./media"
import type { ResolvedSettings } from "./settings"

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

    // A video on one of these platforms (a TikTok, a reel) is what the post shares
    if (classifyMediaUrl(url)) {
      return false
    }

    return EXCLUDED_NESTED_FINAL_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith(`.${d}`)
    )
  } catch {
    return false
  }
}

/** How a nested link was found, when it wasn't simply linked in the post. */
export interface NestedLinkOrigin {
  /** SHOW_NOTES: linked in the notes of the podcast episode this link is nested under. */
  foundVia?: "QUOTED_POST" | "AI_LOOKUP" | "SHOW_NOTES" | null
  /** AI_LOOKUP only: a video (the full recording or the same clip), a podcast episode, or a book. */
  foundRole?: "CLIP" | "FULL" | "EPISODE" | "BOOK" | null
}

export interface NestedLinkOutcome {
  /** A child link now exists for this URL (fetched or not). */
  created: boolean
  /** Its content was fetched. */
  fetched: boolean
  /** Nothing was kept: the user already has this link, or its final URL is excluded. */
  skipped: boolean
  /** The child link, or the link the user already had for this URL. */
  linkId: string | null
  error?: string
}

/**
 * Create one nested link under a post and fetch it, the same way a link
 * from an email is fetched. A URL the user already has is left alone.
 */
export async function createNestedLink(
  parentLink: { id: string; userId: string; emailId: string | null },
  url: string,
  origin: NestedLinkOrigin,
  settings: ResolvedSettings,
  options?: { triggerAi?: boolean }
): Promise<NestedLinkOutcome> {
  const urlHash = hashUrl(url)

  // Check for duplicate by URL
  const existingLink = await prisma.link.findUnique({
    where: { userId_urlHash: { userId: parentLink.userId, urlHash } },
  })

  if (existingLink) {
    console.log(`[Nested Links] Skipping duplicate: ${url}`)
    return { created: false, fetched: false, skipped: true, linkId: existingLink.id }
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
      fetchStatus: "FETCHING",
      foundVia: origin.foundVia ?? null,
      foundRole: origin.foundRole ?? null,
      lookupStatus: awaitsShowNotes(url, origin) ? "PENDING" : null,
    },
  })

  console.log(`[Nested Links] Created child link: ${url}`)

  // Fetch content for the child link
  try {
    const operationId = generateOperationId()
    const content = await fetchWithFallbackChain(url, settings.fetching.fallbackChain, {
      timeoutMs: settings.fetching.fetchTimeoutMs,
    })
    const rawHtml = content.rawHtml

    // Fire-and-forget: record fetch attempts
    recordFetchAttempts(childLink.id, operationId, "nested_fetch", content.attempts).catch((err) =>
      console.error("[Nested Links] Failed to record fetch attempts:", err)
    )

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
      return { created: true, fetched: false, skipped: false, linkId: childLink.id }
    }

    // Check if final URL is excluded
    if (content.finalUrl && isExcludedUrl(content.finalUrl)) {
      console.log(`[Nested Links] Skipping - final URL excluded: ${url}`)
      await prisma.link.delete({ where: { id: childLink.id } })
      return { created: false, fetched: false, skipped: true, linkId: null }
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
        return { created: false, fetched: false, skipped: true, linkId: existingByFinalUrl.id }
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
        contentHtml: content.content,
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

    if (options?.triggerAi !== false) {
      triggerAutoAnalysisAndEmbedding(childLink.id, parentLink.userId)
    }
    return { created: true, fetched: true, skipped: false, linkId: childLink.id }
  } catch (fetchError) {
    await prisma.link.update({
      where: { id: childLink.id },
      data: {
        fetchStatus: "FAILED",
        fetchError: fetchError instanceof Error ? fetchError.message : "Unknown error",
      },
    })
    return {
      created: true,
      fetched: false,
      skipped: false,
      linkId: childLink.id,
      error: `Failed to process nested link ${url}: ${fetchError}`,
    }
  }
}

/**
 * A podcast link is queued for the media lookup, which reads the episode's
 * show notes for the links it discusses. Links that came out of show notes
 * are not: one episode's notes are followed, not the web of episodes they cite.
 */
export function awaitsShowNotes(url: string, origin: NestedLinkOrigin): boolean {
  return origin.foundVia !== "SHOW_NOTES" && classifyMediaUrl(url) === "podcast"
}

/** What a catalog or a show's notes already say about an item, so its page needn't be fetched. */
export interface FoundItem {
  url: string
  title: string
  description: string | null
  imageUrl: string | null
}

/**
 * Create a nested link from details already in hand, without fetching its
 * page: an item found in a catalog (a podcast episode, a book), where the
 * page has nothing worth reading or analyzing, or a link from an episode's
 * show notes, which is kept as a reference. A URL the user already has is
 * left alone.
 */
export async function createFoundLink(
  parentLink: { id: string; userId: string; emailId: string | null },
  item: FoundItem,
  origin: NestedLinkOrigin,
  contentSource: "catalog" | "show_notes" = "catalog"
): Promise<NestedLinkOutcome> {
  const urlHash = hashUrl(item.url)
  const existingLink = await prisma.link.findFirst({
    where: { userId: parentLink.userId, OR: [{ urlHash }, { finalUrlHash: urlHash }] },
    select: { id: true },
  })
  if (existingLink) {
    console.log(`[Nested Links] Skipping duplicate: ${item.url}`)
    return { created: false, fetched: false, skipped: true, linkId: existingLink.id }
  }

  const domain = extractDomain(item.url)
  const childLink = await prisma.link.create({
    data: {
      userId: parentLink.userId,
      emailId: parentLink.emailId,
      parentLinkId: parentLink.id,
      url: item.url,
      urlHash,
      domain,
      finalUrl: item.url,
      finalUrlHash: urlHash,
      finalDomain: domain,
      title: item.title,
      description: item.description,
      imageUrl: item.imageUrl,
      contentText: item.description,
      wordCount: item.description ? item.description.split(/\s+/).filter(Boolean).length : 0,
      contentSource,
      fetchStatus: "FETCHED",
      fetchedAt: new Date(),
      foundVia: origin.foundVia ?? null,
      foundRole: origin.foundRole ?? null,
      lookupStatus: awaitsShowNotes(item.url, origin) ? "PENDING" : null,
    },
  })
  console.log(`[Nested Links] Created found link: ${item.url}`)
  return { created: true, fetched: true, skipped: false, linkId: childLink.id }
}
