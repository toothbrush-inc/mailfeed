import { prisma } from "./prisma"
import { FEATURE_FLAGS } from "./flags"
import { extractNestedUrls, isSocialMediaLink } from "./nested-link-extractor"
import { createNestedLink, loadPostContext, postContextUrls, type NestedLinkOrigin } from "./nested-link"
import { classifyMediaUrl } from "./media"
import { mayNameBook, mayReferToRecording, type PostContext } from "./post-context"
import { triggerMediaLookup } from "./media-lookup"
import type { ResolvedSettings } from "./settings"

interface ProcessNestedLinksResult {
  created: number
  fetched: number
  skipped: number
  /** A post on X whose full text or follow-up posts FxTwitter didn't give. */
  threadUnread: boolean
  errors: string[]
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
    threadUnread: false,
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

  // What the post's context adds: the rest of a long post, the author's
  // follow-up posts, and the links of the post it quotes
  const context = await loadPostContext(parentLink)
  result.threadUnread = !!context && !context.expanded && FEATURE_FLAGS.readXThreads
  for (const entry of await postContextUrls(context)) {
    if (!found.some((other) => other.url === entry.url)) found.push(entry)
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
