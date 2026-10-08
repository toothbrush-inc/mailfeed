/**
 * Catch up links synced before media links were kept.
 *
 * Three passes over what is already stored, with no Gmail access:
 *
 * 0. "urls": store every link's address in its clean form (lib/clean-url.ts),
 *    as links saved now are. Two links that turn out to be the same page are
 *    both left as they are and counted; nothing is merged or deleted.
 * 1. "posts": run nested-link extraction again on every social media post.
 *    Links that used to be dropped (a YouTube video shared in a tweet, the
 *    links of a quoted post) are created as nested links; ones that already
 *    exist are skipped. Posts on X also get their context stored, and are
 *    queued for the media lookup when they point at something they don't link.
 *    A post whose stored text oEmbed cut gets its full text, and goes back
 *    to waiting for analysis.
 *    The lookup itself costs AI calls and is not run here.
 * 2. "titles": videos saved without a title, because a player page has no
 *    article text and used to be recorded as a failed fetch, get their
 *    title and thumbnail from oEmbed.
 *
 * Both do network requests per link, so a call works for a few seconds and
 * returns a cursor; the caller repeats until `done`.
 */

import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { SOCIAL_MEDIA_DOMAINS } from "@/lib/constants/domains"
import { processNestedLinks } from "@/lib/process-nested-links"
import { fetchOEmbed, getOEmbedEndpoint } from "@/lib/oembed-fetcher"
import { classifyMediaUrl } from "@/lib/media"
import { cleanUrl, hashUrl } from "@/lib/link-extractor"
import type { ResolvedSettings } from "@/lib/settings"
import "@/lib/fetchers/direct"
import "@/lib/fetchers/wayback"

type Phase = "urls" | "posts" | "titles"

export interface MediaRescanResult {
  /** Pass back to continue; null once everything has been looked at. */
  cursor: string | null
  done: boolean
  phase: Phase
  /** Posts and untitled videos handled by this call. */
  scanned: number
  /** Posts and untitled videos still to go after this call. */
  remaining: number
  /** Nested links created by this call. */
  linksFound: number
  /** Posts on X that FxTwitter couldn't read in full in this call. They are read again on the next scan. */
  threadsUnread: number
  /** Posts on X whose cut text was replaced with the full text in this call. They are analyzed again by Analyze. */
  textsCompleted: number
  /** Videos given a title by this call. */
  titlesFilled: number
  /** Links whose stored address lost its tracking parameters in this call. */
  addressesCleaned: number
  /** Links that are the same page as another link once cleaned. Left as they are. */
  duplicateAddresses: number
  errors: string[]
}

const DEFAULT_BUDGET_MS = 20_000
const CONCURRENCY = 4

function parseCursor(cursor: string | null | undefined): { phase: Phase; after: string | null } {
  const [phase, after] = (cursor ?? "").split(":")
  if (phase === "urls" || phase === "posts" || phase === "titles") return { phase, after: after || null }
  return { phase: "urls", after: null }
}

// Addresses are cleaned with no network, so a page of them is large
const URL_PAGE = 300

/**
 * Store one page of links' addresses in their clean form and bring their
 * hashes up to date with the current rules. Returns the last id looked at,
 * or null when there are no links left.
 */
async function cleanStoredAddresses(
  userId: string,
  after: string | null,
  result: Pick<MediaRescanResult, "scanned" | "addressesCleaned" | "duplicateAddresses">
): Promise<string | null> {
  const links = await prisma.link.findMany({
    where: { userId, ...(after ? { id: { gt: after } } : {}) },
    orderBy: { id: "asc" },
    take: URL_PAGE,
    select: { id: true, url: true, urlHash: true, finalUrl: true, finalUrlHash: true },
  })
  for (const link of links) {
    const url = cleanUrl(link.url)
    const urlHash = hashUrl(url)
    const finalUrlHash = link.finalUrl ? hashUrl(link.finalUrl) : link.finalUrlHash
    if (url === link.url && urlHash === link.urlHash && finalUrlHash === link.finalUrlHash) continue

    // Another link is already this page: (userId, urlHash) is unique, and
    // which of the two to keep is not for a scan to decide
    const twin =
      urlHash !== link.urlHash
        ? await prisma.link.findFirst({ where: { userId, urlHash, id: { not: link.id } }, select: { id: true } })
        : null
    if (twin) {
      result.duplicateAddresses++
      if (finalUrlHash !== link.finalUrlHash) {
        await prisma.link.updateMany({ where: { id: link.id, userId }, data: { finalUrlHash } })
      }
      continue
    }
    await prisma.link.updateMany({ where: { id: link.id, userId }, data: { url, urlHash, finalUrlHash } })
    if (url !== link.url) result.addressesCleaned++
  }
  result.scanned += links.length
  return links.length > 0 ? links[links.length - 1].id : null
}

// Mirrors isSocialMediaDomain(), which processNestedLinks applies itself
const SOCIAL_POST: Prisma.LinkWhereInput = {
  OR: SOCIAL_MEDIA_DOMAINS.flatMap((domain) => [
    { domain: { contains: domain } },
    { finalDomain: { contains: domain } },
  ]),
}

function postsWhere(userId: string, after: string | null): Prisma.LinkWhereInput {
  return {
    userId,
    parentLinkId: null,
    rawHtml: { not: null },
    ...(after ? { id: { gt: after } } : {}),
    AND: [SOCIAL_POST],
  }
}

// Hosts with an oEmbed endpoint that serve videos (see lib/oembed-fetcher.ts)
const OEMBED_VIDEO_HOSTS = ["youtube.com", "youtu.be", "tiktok.com"]

function untitledVideosWhere(userId: string, after: string | null): Prisma.LinkWhereInput {
  return {
    userId,
    ...(after ? { id: { gt: after } } : {}),
    AND: [
      { OR: [{ title: null }, { title: "" }] },
      { OR: OEMBED_VIDEO_HOSTS.map((host) => ({ domain: { endsWith: host } })) },
    ],
  }
}

export async function rescanForMedia(
  userId: string,
  cursor: string | null | undefined,
  settings: ResolvedSettings,
  options: { budgetMs?: number; triggerAi?: boolean } = {}
): Promise<MediaRescanResult> {
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS)
  let { phase, after } = parseCursor(cursor)
  const result: MediaRescanResult = {
    cursor: null,
    done: false,
    phase,
    scanned: 0,
    remaining: 0,
    linksFound: 0,
    titlesFilled: 0,
    threadsUnread: 0,
    textsCompleted: 0,
    addressesCleaned: 0,
    duplicateAddresses: 0,
    errors: [],
  }

  while (phase === "urls" && Date.now() < deadline) {
    const last = await cleanStoredAddresses(userId, after, result)
    if (last === null) {
      phase = "posts"
      after = null
      break
    }
    after = last
  }

  while (phase === "posts" && Date.now() < deadline) {
    const posts = await prisma.link.findMany({
      where: postsWhere(userId, after),
      orderBy: { id: "asc" },
      take: CONCURRENCY,
      select: {
        id: true,
        userId: true,
        emailId: true,
        url: true,
        finalUrl: true,
        rawHtml: true,
        domain: true,
        finalDomain: true,
      },
    })
    if (posts.length === 0) {
      phase = "titles"
      after = null
      break
    }

    const outcomes = await Promise.all(
      posts.map((post) =>
        // lookup: false — the scan is free; lookups are started separately
        processNestedLinks(post, settings, { triggerAi: options.triggerAi, lookup: false }).catch((error) => ({
          created: 0,
          threadUnread: false,
          textCompleted: false,
          errors: [`${post.url}: ${error instanceof Error ? error.message : error}`],
        }))
      )
    )
    for (const outcome of outcomes) {
      result.linksFound += outcome.created
      if (outcome.threadUnread) result.threadsUnread++
      if (outcome.textCompleted) result.textsCompleted++
      result.errors.push(...outcome.errors)
    }
    result.scanned += posts.length
    after = posts[posts.length - 1].id
  }

  while (phase === "titles" && Date.now() < deadline) {
    const videos = await prisma.link.findMany({
      where: untitledVideosWhere(userId, after),
      orderBy: { id: "asc" },
      take: CONCURRENCY,
      select: { id: true, url: true, imageUrl: true, description: true },
    })
    if (videos.length === 0) {
      result.done = true
      break
    }

    await Promise.all(
      videos.map(async (video) => {
        if (classifyMediaUrl(video.url) !== "video" || !getOEmbedEndpoint(video.url)) return
        const embed = await fetchOEmbed(video.url)
        if (!embed.success || !embed.title) return
        await prisma.link.updateMany({
          where: { id: video.id, userId },
          data: {
            title: embed.title,
            imageUrl: video.imageUrl ?? embed.thumbnailUrl ?? null,
            description:
              video.description ??
              (embed.authorName
                ? `By ${embed.authorName}${embed.providerName ? ` on ${embed.providerName}` : ""}`
                : null),
          },
        })
        result.titlesFilled++
      })
    )
    result.scanned += videos.length
    after = videos[videos.length - 1].id
  }

  result.phase = phase
  if (!result.done) {
    result.cursor = `${phase}:${after ?? ""}`
    const [links, posts, videos] = await Promise.all([
      phase === "urls" ? prisma.link.count({ where: { userId, ...(after ? { id: { gt: after } } : {}) } }) : 0,
      phase === "titles" ? 0 : prisma.link.count({ where: postsWhere(userId, phase === "posts" ? after : null) }),
      prisma.link.count({ where: untitledVideosWhere(userId, phase === "titles" ? after : null) }),
    ])
    result.remaining = links + posts + videos
  }
  return result
}
