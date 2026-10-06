/**
 * Catch up links synced before media links were kept.
 *
 * Two passes over what is already stored, with no Gmail access:
 *
 * 1. "posts": run nested-link extraction again on every social media post.
 *    Links that used to be dropped (a YouTube video shared in a tweet, the
 *    links of a quoted post) are created as nested links; ones that already
 *    exist are skipped. Posts on X also get their context stored, and are
 *    queued for the media lookup when they point at something they don't link.
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
import type { ResolvedSettings } from "@/lib/settings"
import "@/lib/fetchers/direct"
import "@/lib/fetchers/wayback"

type Phase = "posts" | "titles"

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
  /** Videos given a title by this call. */
  titlesFilled: number
  errors: string[]
}

const DEFAULT_BUDGET_MS = 20_000
const CONCURRENCY = 4

function parseCursor(cursor: string | null | undefined): { phase: Phase; after: string | null } {
  const [phase, after] = (cursor ?? "").split(":")
  if (phase === "posts" || phase === "titles") return { phase, after: after || null }
  return { phase: "posts", after: null }
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
    errors: [],
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
          errors: [`${post.url}: ${error instanceof Error ? error.message : error}`],
        }))
      )
    )
    for (const outcome of outcomes) {
      result.linksFound += outcome.created
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
    const [posts, videos] = await Promise.all([
      phase === "posts" ? prisma.link.count({ where: postsWhere(userId, after) }) : 0,
      prisma.link.count({ where: untitledVideosWhere(userId, phase === "titles" ? after : null) }),
    ])
    result.remaining = posts + videos
  }
  return result
}
