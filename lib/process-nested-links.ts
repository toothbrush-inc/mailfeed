import type { Prisma } from "@prisma/client"
import { prisma } from "./prisma"
import { extractNestedUrls, isSocialMediaLink, resolveNestedUrl } from "./nested-link-extractor"
import { createNestedLink, type NestedLinkOrigin } from "./nested-link"
import { classifyMediaUrl } from "./media"
import {
  fetchPostContext,
  mayNameBook,
  mayReferToRecording,
  postIdFromUrl,
  readPostContext,
  type PostContext,
} from "./post-context"
import { triggerMediaLookup } from "./media-lookup"
import type { ResolvedSettings } from "./settings"

interface ProcessNestedLinksResult {
  created: number
  fetched: number
  skipped: number
  errors: string[]
}

/**
 * The stored context of a post on X, fetched and saved the first time.
 * Null for other platforms and for posts the embed endpoint won't return.
 */
async function loadPostContext(parentLink: {
  id: string
  userId: string
  url: string
  finalUrl: string | null
}): Promise<PostContext | null> {
  const postUrl = [parentLink.finalUrl, parentLink.url].find((url) => postIdFromUrl(url))
  if (!postUrl) return null

  const stored = await prisma.link.findFirst({
    where: { id: parentLink.id, userId: parentLink.userId },
    select: { postContext: true },
  })
  const existing = readPostContext(stored?.postContext)
  if (existing) return existing

  const context = await fetchPostContext(postUrl)
  if (context) {
    await prisma.link.updateMany({
      where: { id: parentLink.id, userId: parentLink.userId },
      data: { postContext: context as unknown as Prisma.InputJsonValue },
    })
  }
  return context
}

/**
 * Mark a post for the media lookup when it points at something it doesn't
 * link: a recording (an uploaded clip, or words like "this talk") while
 * none of its links is one, or a book. A post that was already looked up,
 * or whose finds were rejected, keeps its status.
 */
async function flagForLookup(
  parentLink: { id: string; userId: string },
  context: PostContext | null
): Promise<boolean> {
  let worthALook = mayNameBook(context)
  if (!worthALook && mayReferToRecording(context)) {
    const children = await prisma.link.findMany({
      where: { userId: parentLink.userId, parentLinkId: parentLink.id },
      select: { url: true, finalUrl: true },
    })
    worthALook = !children.some((child) => {
      const type = classifyMediaUrl(child.finalUrl) ?? classifyMediaUrl(child.url)
      return type === "video" || type === "podcast"
    })
  }
  if (!worthALook) return false

  const flagged = await prisma.link.updateMany({
    where: { id: parentLink.id, userId: parentLink.userId, lookupStatus: null },
    data: { lookupStatus: "PENDING" },
  })
  return flagged.count === 1
}

/**
 * Extract and process nested links from a parent social media link:
 * the links in the post and, for posts on X, the links in the post it
 * quotes. A podcast episode is queued for the media lookup instead, which
 * reads the links in its show notes. Then flag the post for the media lookup if it has a video that
 * none of those links leads to, or names a recording or a book.
 */
export async function processNestedLinks(
  parentLink: {
    id: string
    userId: string
    emailId: string | null
    url: string
    finalUrl: string | null
    rawHtml: string | null
    finalDomain: string | null
    domain: string | null
  },
  settings: ResolvedSettings,
  options?: {
    triggerAi?: boolean
    /** Start the media lookup for a post that needs one. Defaults to triggerAi. */
    lookup?: boolean
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
    // A podcast episode's nested links are in its show notes. Reading them
    // takes the show's feed and an AI pass, so it is left to the media lookup.
    if ((classifyMediaUrl(parentLink.finalUrl) ?? classifyMediaUrl(parentLink.url)) === "podcast") {
      const flagged = await prisma.link.updateMany({
        where: { id: parentLink.id, userId: parentLink.userId, lookupStatus: null },
        data: { lookupStatus: "PENDING" },
      })
      if (flagged.count === 1 && (options?.lookup ?? options?.triggerAi !== false)) {
        triggerMediaLookup(parentLink.id, parentLink.userId)
      }
    }
    return result
  }

  // Extract nested URLs from the rawHtml (resolves URL shorteners)
  const nestedUrls = await extractNestedUrls(parentLink.rawHtml)
  console.log(`[Nested Links] Found ${nestedUrls.length} nested URLs in ${domain} post`)

  const found: Array<{ url: string; origin: NestedLinkOrigin }> = nestedUrls.map((url) => ({ url, origin: {} }))

  // The links of the post this one quotes: "look at this" over someone
  // else's post is about whatever that post links to
  const context = await loadPostContext(parentLink)
  for (const quotedUrl of context?.quoted?.urls ?? []) {
    const url = await resolveNestedUrl(quotedUrl)
    if (url && !found.some((entry) => entry.url === url)) {
      console.log(`[Nested Links] Found in quoted post: ${url}`)
      found.push({ url, origin: { foundVia: "QUOTED_POST" } })
    }
  }

  for (const { url, origin } of found) {
    const outcome = await createNestedLink(parentLink, url, origin, settings, options)
    if (outcome.created) result.created++
    if (outcome.fetched) result.fetched++
    if (outcome.skipped) result.skipped++
    if (outcome.error) result.errors.push(outcome.error)
  }

  const needsLookup = await flagForLookup(parentLink, context)
  if (needsLookup && (options?.lookup ?? options?.triggerAi !== false)) {
    triggerMediaLookup(parentLink.id, parentLink.userId)
  }

  return result
}
