/**
 * The Media page's list: every video, podcast, book and game among a user's
 * links, whether emailed directly or found inside a post.
 */

import { prisma } from "@/lib/prisma"
import type { PostVideo } from "@/lib/post-context"
import {
  MEDIA_LINK_TAGS,
  MEDIA_URL_PATTERN,
  classifyMedia,
  mediaHostPattern,
  mediaKey,
  youtubeVideoId,
  type MediaClassification,
  type MediaType,
} from "@/lib/media"

interface CandidateRow {
  id: string
  parentLinkId: string | null
  url: string
  finalUrl: string | null
  domain: string | null
  finalDomain: string | null
  title: string | null
  linkTags: string[]
  contentTags: string[]
  foundVia: string | null
  foundRole: string | null
  /** The video uploaded to a post, or to the post it quotes (see lib/post-context.ts). */
  postVideo: PostVideo | null
  lookupStatus: string | null
  lookupNote: string | null
  sharedAt: Date
}

/** How an entry got on the list, when it isn't a link emailed or posted as such. */
export type MediaVia =
  /** The post itself: its video is uploaded to it and no public source is known. */
  | "POST_VIDEO"
  /** Linked in the post that the emailed post quotes. */
  | "QUOTED_POST"
  /** Found by the media lookup for something the post or page points at without linking it. */
  | "AI_LOOKUP"
  /** Linked in the show notes of a podcast episode among the user's links. */
  | "SHOW_NOTES"

/** What a found link is: a video (the full recording or the same clip), a podcast episode, a book. */
export type FoundRole = "FULL" | "CLIP" | "EPISODE" | "BOOK"
const FOUND_ROLES: readonly string[] = ["FULL", "CLIP", "EPISODE", "BOOK"]

export interface MediaItem {
  id: string
  type: MediaType
  /** "url": recognized by its URL. "ai": tagged by the analysis. "post": a post with an uploaded video. */
  source: MediaClassification["source"] | "post"
  url: string
  domain: string | null
  title: string | null
  description: string | null
  summary: string | null
  imageUrl: string | null
  /** When the email carrying it arrived (or when it was added by hand). */
  sharedAt: string
  isRead: boolean
  isLiked: boolean
  /** The link to open in the feed: the post it was found in, or itself. */
  feedLinkId: string
  /** The post or page this was found in or for, for links that weren't emailed directly. */
  post: { id: string; url: string; title: string | null; domain: string | null } | null
  /** Other links to the same item (the same video shared twice). */
  duplicates: number
  via: MediaVia | null
  /** AI_LOOKUP only: what the lookup found this to be. */
  role: FoundRole | null
  /** AI_LOOKUP only: the short clip, when this entry is the full recording. */
  alternate: { id: string; url: string; title: string | null } | null
  /** The media lookup of the post or page behind this entry (POST_VIDEO and AI_LOOKUP). */
  lookup: { postId: string; status: string | null; note: string | null } | null
}

export interface MediaListResult {
  type: MediaType | null
  counts: Record<MediaType | "all", number>
  items: MediaItem[]
  pagination: { page: number; limit: number; total: number; totalPages: number }
}

export interface MediaListOptions {
  type?: MediaType | null
  search?: string | null
  page?: number
  limit?: number
  hiddenDomains?: string[]
}

interface Classified {
  row: CandidateRow
  media: Pick<MediaClassification, "type"> & { source: MediaItem["source"] }
  duplicates: number
  alternate?: CandidateRow
}

function viaOf(row: CandidateRow): MediaVia | null {
  if (row.foundVia === "AI_LOOKUP" || row.foundVia === "QUOTED_POST" || row.foundVia === "SHOW_NOTES") return row.foundVia
  return null
}

/**
 * Every media link of a user, newest first, one entry per item.
 *
 * SQL narrows the links to those a rule could match (a known host, a
 * podcast-looking URL, a media tag, a post with an uploaded video).
 * classifyMedia then decides, in the app, so the rules live in one place.
 *
 * A post with an uploaded video is one entry however much is known about
 * it: the post itself while its source is unknown, or the recording the
 * lookup found, with the matching short clip folded into the same entry.
 * Podcast episodes and books the lookup found are entries of their own.
 */
async function findMediaLinks(userId: string, hiddenDomains: string[]): Promise<Classified[]> {
  const rows = await prisma.$queryRaw<CandidateRow[]>`
    SELECT l."id", l."parentLinkId", l."url", l."finalUrl", l."domain", l."finalDomain", l."title",
           l."linkTags", l."contentTags", l."foundVia", l."foundRole",
           COALESCE(
             NULLIF(l."postContext"->'video', 'null'::jsonb),
             NULLIF(l."postContext"->'quoted'->'video', 'null'::jsonb)
           ) AS "postVideo",
           l."lookupStatus", l."lookupNote",
           COALESCE(e."receivedAt", l."createdAt") AS "sharedAt"
    FROM "Link" l
    LEFT JOIN "Email" e ON e."id" = l."emailId" AND e."userId" = l."userId"
    WHERE l."userId" = ${userId}
      AND (
        l."domain" ~* ${mediaHostPattern()}
        OR l."finalDomain" ~* ${mediaHostPattern()}
        OR l."url" ~* ${MEDIA_URL_PATTERN}
        OR l."finalUrl" ~* ${MEDIA_URL_PATTERN}
        OR l."linkTags" && ${[...MEDIA_LINK_TAGS]}::text[]
        OR jsonb_typeof(l."postContext"->'video') = 'object'
        OR jsonb_typeof(l."postContext"->'quoted'->'video') = 'object'
      )
    ORDER BY "sharedAt" DESC, l."id" DESC
  `

  const hidden = new Set(hiddenDomains)
  const classified: Classified[] = []
  for (const row of rows) {
    if ((row.domain && hidden.has(row.domain)) || (row.finalDomain && hidden.has(row.finalDomain))) continue
    const media = classifyMedia(row)
    const hasUploadedVideo = !!row.postVideo && typeof row.postVideo === "object"
    // An uploaded video is known for certain; the analysis tag on a post is a guess at the same thing
    if (hasUploadedVideo && media?.source !== "url") {
      classified.push({ row, media: { type: "video", source: "post" }, duplicates: 0 })
    } else if (media) {
      classified.push({ row, media, duplicates: 0 })
    }
  }

  // A post whose video is already on the list through one of its links
  // (linked in it, in the post it quotes, or found by the lookup) is not
  // listed a second time as itself
  const postsWithVideoLink = new Set(
    classified
      .filter((entry) => entry.media.source !== "post" && entry.media.type === "video" && entry.row.parentLinkId)
      .map((entry) => entry.row.parentLinkId)
  )

  const byKey = new Map<string, Classified>()
  for (const entry of classified) {
    const { row, media } = entry
    if (media.source === "post" && postsWithVideoLink.has(row.id)) continue

    const key = `${media.type}:${mediaKey(row)}`
    const kept = byKey.get(key)
    if (!kept) {
      byKey.set(key, entry)
    } else {
      kept.duplicates++
      // Rows are newest first. Keep the newest, unless only an older one has a title.
      if (!kept.row.title && row.title) kept.row = { ...row, sharedAt: kept.row.sharedAt }
    }
  }

  // The lookup's clip and full recording for the same post are one entry
  const entries = Array.from(byKey.values())
  const fullByPost = new Map<string, Classified>()
  for (const entry of entries) {
    if (entry.row.foundVia === "AI_LOOKUP" && entry.row.foundRole === "FULL" && entry.row.parentLinkId) {
      fullByPost.set(entry.row.parentLinkId, entry)
    }
  }
  return entries.filter((entry) => {
    const { row } = entry
    if (row.foundVia !== "AI_LOOKUP" || row.foundRole !== "CLIP" || !row.parentLinkId) return true
    const full = fullByPost.get(row.parentLinkId)
    if (!full) return true
    full.alternate = row
    return false
  })
}

function matchesSearch(entry: Classified, needle: string): boolean {
  return [entry.row, entry.alternate].some(
    (row) => row && [row.title, row.url, row.finalUrl].some((text) => text?.toLowerCase().includes(needle))
  )
}

export async function listMedia(userId: string, options: MediaListOptions = {}): Promise<MediaListResult> {
  const type = options.type ?? null
  const page = Math.max(1, options.page ?? 1)
  const limit = Math.min(Math.max(options.limit ?? 30, 1), 100)
  const needle = options.search?.trim().toLowerCase()

  let all = await findMediaLinks(userId, options.hiddenDomains ?? [])
  if (needle) all = all.filter((entry) => matchesSearch(entry, needle))

  const counts = { all: all.length, video: 0, podcast: 0, book: 0, game: 0 } as Record<MediaType | "all", number>
  for (const entry of all) counts[entry.media.type]++

  const ofType = type ? all.filter((entry) => entry.media.type === type) : all
  const pageEntries = ofType.slice((page - 1) * limit, page * limit)

  const details = await prisma.link.findMany({
    where: { userId, id: { in: pageEntries.map((entry) => entry.row.id) } },
    select: {
      id: true,
      description: true,
      aiSummary: true,
      imageUrl: true,
      isRead: true,
      isLiked: true,
      parentLink: {
        where: { userId },
        select: {
          id: true,
          url: true,
          finalUrl: true,
          title: true,
          domain: true,
          finalDomain: true,
          parentLinkId: true,
          lookupStatus: true,
          lookupNote: true,
        },
      },
    },
  })
  const detailById = new Map(details.map((detail) => [detail.id, detail]))

  const items: MediaItem[] = pageEntries.map(({ row, media, duplicates, alternate }) => {
    const detail = detailById.get(row.id)
    const url = row.finalUrl || row.url
    const youtubeId = youtubeVideoId(url)
    const post = detail?.parentLink ?? null
    const via: MediaVia | null = media.source === "post" ? "POST_VIDEO" : viaOf(row)
    const lookup =
      via === "POST_VIDEO"
        ? { postId: row.id, status: row.lookupStatus, note: row.lookupNote }
        : via === "AI_LOOKUP" && post
          ? { postId: post.id, status: post.lookupStatus, note: post.lookupNote }
          : null
    return {
      id: row.id,
      type: media.type,
      source: media.source,
      url,
      domain: row.finalDomain || row.domain,
      title: row.title,
      description: detail?.description ?? null,
      summary: detail?.aiSummary ?? null,
      imageUrl:
        detail?.imageUrl ??
        (via === "POST_VIDEO" ? row.postVideo?.poster : null) ??
        (youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/mqdefault.jpg` : null),
      sharedAt: new Date(row.sharedAt).toISOString(),
      isRead: detail?.isRead ?? false,
      isLiked: detail?.isLiked ?? false,
      // The feed lists top-level links: a page found inside a post opens as that post
      feedLinkId: post ? (post.parentLinkId ?? post.id) : row.id,
      post: post
        ? {
            id: post.id,
            url: post.finalUrl || post.url,
            title: post.title,
            domain: post.finalDomain || post.domain,
          }
        : null,
      duplicates,
      via,
      role: via === "AI_LOOKUP" && row.foundRole && FOUND_ROLES.includes(row.foundRole) ? (row.foundRole as FoundRole) : null,
      alternate: alternate
        ? { id: alternate.id, url: alternate.finalUrl || alternate.url, title: alternate.title }
        : null,
      lookup,
    }
  })

  return {
    type,
    counts,
    items,
    pagination: {
      page,
      limit,
      total: ofType.length,
      totalPages: Math.max(1, Math.ceil(ofType.length / limit)),
    },
  }
}
