/**
 * What a post on X says beyond its text: the video attached to it, the
 * links in it, and the post it quotes.
 *
 * oEmbed (lib/oembed-fetcher.ts) only gives the post's own text. The
 * endpoint that embedded posts are rendered from gives the rest, and needs
 * no API key. It is not a documented API: when it fails or changes shape
 * this returns null and the post is handled as before, from oEmbed alone.
 *
 * That endpoint cuts a long post at 280 characters, and the link to the
 * full video is often past the cut (after the chapter timestamps) or in a
 * follow-up post by the same author. For a long post or one with a video,
 * FxTwitter (api.fxtwitter.com, open source, no key) gives the full text
 * and the author's follow-up posts. When it fails, the post keeps what the
 * embed endpoint gave and is read again the next time it is processed.
 * READ_X_THREADS=false turns FxTwitter off.
 */

import { FEATURE_FLAGS } from "@/lib/flags"
import { safeFetch } from "@/lib/safe-fetch"

export interface PostVideo {
  /** Still image for the video. */
  poster: string | null
  durationMs: number | null
}

export interface PostPart {
  id: string
  url: string
  author: { name: string | null; handle: string | null }
  text: string
  /** A video uploaded to the post itself (not a link to one). */
  video: PostVideo | null
  /** Links in the post, as the author wrote them (not t.co). */
  urls: string[]
}

export interface PostContext extends PostPart {
  fetchedAt: string
  /** The post this one quotes. */
  quoted: PostPart | null
  /**
   * The full text of long posts and the links in the author's follow-up
   * posts were read, where there was anything to read. Absent on contexts
   * stored before they were; those are fetched again.
   */
  expanded?: boolean
}

const POST_URL = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[^/]+)\/status(?:es)?\/(\d+)/i

/** The id of a post on X, or null when the URL isn't one. */
export function postIdFromUrl(url: string | null | undefined): string | null {
  return url?.match(POST_URL)?.[1] ?? null
}

// The token the embed endpoint expects, derived from the id the same way
// the embed widget does it
function embedToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "")
}

type Json = Record<string, unknown>

function asObject(value: unknown): Json | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseVideo(raw: Json): PostVideo | null {
  // GIFs are listed as media too, but they are not a recording of anything
  const details = asArray(raw.mediaDetails).map(asObject)
  const media = details.find((item) => item?.type === "video")
  const video = details.length === 0 ? asObject(raw.video) : null
  if (!media && !video) return null
  const info = asObject(media?.video_info)
  const duration = info?.duration_millis ?? video?.durationMs
  return {
    poster: asString(media?.media_url_https) ?? asString(video?.poster),
    durationMs: typeof duration === "number" ? duration : null,
  }
}

function parsePart(raw: Json): PostPart | null {
  const id = asString(raw.id_str)
  if (!id) return null
  const user = asObject(raw.user)
  const handle = asString(user?.screen_name)
  const entities = asObject(raw.entities)
  const urls = asArray(entities?.urls)
    .map((entry) => asString(asObject(entry)?.expanded_url))
    .filter((url): url is string => !!url && /^https?:\/\//i.test(url))

  return {
    id,
    url: `https://x.com/${handle ?? "i"}/status/${id}`,
    author: { name: asString(user?.name), handle },
    text: asString(raw.text) ?? "",
    video: parseVideo(raw),
    urls: Array.from(new Set(urls)),
  }
}

/** Build a PostContext from the embed endpoint's JSON, or null if it isn't a post. */
export function parsePostContext(raw: unknown, now: Date = new Date()): PostContext | null {
  const post = asObject(raw)
  if (!post || (post.__typename && post.__typename !== "Tweet")) return null
  const main = parsePart(post)
  if (!main) return null
  const quotedRaw = asObject(post.quoted_tweet)
  return {
    ...main,
    fetchedAt: now.toISOString(),
    quoted: quotedRaw ? parsePart(quotedRaw) : null,
  }
}

// A long post, or one with a video, may have its link past the cut or in a follow-up
function needsExpanding(raw: Json | null): boolean {
  return !!raw && (!!raw.note_tweet || parseVideo(raw) !== null)
}

const MAX_FOLLOW_UPS = 10
const THREAD_TIMEOUT_MS = 5_000

function idAfter(id: string, after: string): boolean {
  try {
    return BigInt(id) > BigInt(after)
  } catch {
    return false
  }
}

/**
 * The full text of a post and the links in it and in its author's
 * follow-up posts, from FxTwitter's thread response. Null when the
 * response isn't about this post.
 */
export function parseThread(raw: unknown, id: string): { text: string | null; urls: string[] } | null {
  const data = asObject(raw)
  const status = asObject(data?.status)
  if (!status || asString(status.id) !== id) return null
  const authorId = asString(asObject(status.author)?.id)

  const linksOf = (post: Json | null) =>
    asArray(asObject(post?.raw_text)?.facets)
      .map(asObject)
      .filter((facet) => facet?.type === "url")
      .map((facet) => asString(facet?.replacement))
      .filter((url): url is string => !!url && /^https?:\/\//i.test(url))

  // The thread holds the posts before this one and replies by others too
  const followUps = asArray(data?.thread)
    .map(asObject)
    .filter((post) => {
      const postId = asString(post?.id)
      return !!postId && !!authorId && asString(asObject(post?.author)?.id) === authorId && idAfter(postId, id)
    })
    .slice(0, MAX_FOLLOW_UPS)

  return {
    text: asString(status.text),
    urls: Array.from(new Set([...linksOf(status), ...followUps.flatMap(linksOf)])),
  }
}

/** A part with the full text and the links its thread adds. Null when FxTwitter couldn't be read. */
async function expandPart(part: PostPart): Promise<PostPart | null> {
  // Its own timeout, so a slow FxTwitter can't hold up a sync for long
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), THREAD_TIMEOUT_MS)
  try {
    const response = await safeFetch(`https://api.fxtwitter.com/2/thread/${part.id}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; MailFeed/1.0)", Accept: "application/json" },
      signal: controller.signal,
    })
    if (!response.ok) {
      console.log(`[Post Context] FxTwitter ${response.status} for post ${part.id}`)
      return null
    }
    const thread = parseThread(await response.json(), part.id)
    if (!thread) return null
    return {
      ...part,
      text: thread.text && thread.text.length > part.text.length ? thread.text : part.text,
      urls: Array.from(new Set([...part.urls, ...thread.urls])),
    }
  } catch (error) {
    console.log(`[Post Context] Could not read the thread of post ${part.id}:`, error instanceof Error ? error.message : error)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** Read a stored Link.postContext back, ignoring anything that isn't one. */
export function readPostContext(stored: unknown): PostContext | null {
  const context = asObject(stored)
  if (!context || typeof context.id !== "string" || typeof context.text !== "string") return null
  return context as unknown as PostContext
}

/** Fetch the context of a post on X. Null when the URL isn't a post or the post can't be read. */
export async function fetchPostContext(url: string, options?: { timeoutMs?: number }): Promise<PostContext | null> {
  const id = postIdFromUrl(url)
  if (!id) return null

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 10_000)
  try {
    const response = await safeFetch(
      `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${embedToken(id)}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; MailFeed/1.0)", Accept: "application/json" },
        signal: controller.signal,
      }
    )
    if (!response.ok) {
      console.log(`[Post Context] ${response.status} for post ${id}`)
      return null
    }
    const raw = asObject(await response.json())
    const context = parsePostContext(raw)
    if (!context) return null

    clearTimeout(timeout)
    if (!FEATURE_FLAGS.readXThreads) return { ...context, expanded: false }

    const [main, quoted] = await Promise.all([
      needsExpanding(raw) ? expandPart(context) : context,
      context.quoted && needsExpanding(asObject(raw?.quoted_tweet)) ? expandPart(context.quoted) : context.quoted,
    ])
    return {
      ...context,
      ...(main ?? {}),
      fetchedAt: context.fetchedAt,
      quoted: quoted ?? context.quoted,
      expanded: main !== null && (quoted !== null || context.quoted === null),
    }
  } catch (error) {
    console.log(`[Post Context] Could not read post ${id}:`, error instanceof Error ? error.message : error)
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/** The part of the post (itself or the one it quotes) that carries an uploaded video. */
export function postVideoPart(context: PostContext | null): PostPart | null {
  if (!context) return null
  if (context.video) return context
  if (context.quoted?.video) return context.quoted
  return null
}

// Words that suggest a post is pointing at a recording without linking it
const RECORDING_WORDS =
  /\b(video|talk|interview|lecture|podcast|episode|documentary|keynote|speech|clip|watch(ed|ing)?|listen(ed|ing)?|fireside|conversation with|presentation|livestream|debate)\b/i

/**
 * Whether a post may point at a recording (a video or a podcast episode)
 * that it doesn't link: it carries a video that links nowhere, or its
 * words suggest one. Only a first cut, with no AI: the lookup's own triage
 * step decides whether there is anything to find.
 */
export function mayReferToRecording(context: PostContext | null): boolean {
  if (!context) return false
  if (postVideoPart(context)) return true
  return RECORDING_WORDS.test(`${context.text} ${context.quoted?.text ?? ""}`)
}

// "read" alone is in every other post ("worth a read"), so only the
// phrases that go with a book count
const BOOK_WORDS =
  /\b(books?|novel|memoir|biography|audiobook|author|paperback|hardcover|kindle|reading list|(just|finished|currently|re-?)\s?read(ing)?)\b/i

/** Whether a post's words suggest it names a book. A first cut, like mayReferToRecording. */
export function mayNameBook(context: PostContext | null): boolean {
  if (!context) return false
  return BOOK_WORDS.test(`${context.text} ${context.quoted?.text ?? ""}`)
}
