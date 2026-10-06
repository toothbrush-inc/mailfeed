/**
 * Public catalogs the media lookup searches for a podcast episode or a
 * book. Both are free and need no key. Everything returned here is a real
 * catalog entry, so a link built from it always exists; what remains to be
 * decided is whether it is the right one.
 */

import { safeFetch } from "@/lib/safe-fetch"

const USER_AGENT = "MailFeed/1.0 (https://github.com/toothbrush-inc/mailfeed)"

async function getJson(url: string, timeoutMs = 10_000): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await safeFetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timeout)
  }
}

type Json = Record<string, unknown>
const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null)
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

// ---------------------------------------------------------------------------
// Podcast episodes: Apple's iTunes Search API
// ---------------------------------------------------------------------------

export interface PodcastEpisode {
  /** The episode's page on Apple Podcasts. */
  url: string
  title: string
  show: string | null
  released: string | null
  description: string | null
  imageUrl: string | null
  /** The show's RSS feed and the episode's id in it: where its show notes are (lib/show-notes.ts). */
  feedUrl: string | null
  guid: string | null
  /** Apple's id for the episode: the ?i= of its page. */
  trackId: string | null
}

/** Read the episodes out of an iTunes Search answer. */
export function parsePodcastEpisodes(raw: unknown): PodcastEpisode[] {
  const episodes: PodcastEpisode[] = []
  for (const entry of list((raw as Json | null)?.results)) {
    const item = entry as Json
    const page = str(item.trackViewUrl)
    const title = str(item.trackName)
    if (item.wrapperType !== "podcastEpisode" || !page || !title) continue

    // Keep ?i=<episode>, which is what makes it this episode; drop the tracking parameter
    const url = new URL(page)
    url.searchParams.delete("uo")
    const description = str(item.shortDescription) ?? str(item.description)
    episodes.push({
      url: url.toString(),
      title,
      show: str(item.collectionName),
      released: str(item.releaseDate)?.slice(0, 10) ?? null,
      description: description ? description.replace(/\s+/g, " ").slice(0, 300) : null,
      imageUrl: str(item.artworkUrl600) ?? str(item.artworkUrl160),
      feedUrl: str(item.feedUrl),
      guid: str(item.episodeGuid),
      trackId: typeof item.trackId === "number" ? String(item.trackId) : str(item.trackId),
    })
  }
  return episodes
}

/**
 * Episodes matching any of the search terms, each episode once, in the
 * catalog's order. Throws when the catalog can't be reached, so "nothing
 * found" always means the catalog was asked.
 */
export async function searchPodcastEpisodes(terms: string[], perTerm = 8): Promise<PodcastEpisode[]> {
  const found = new Map<string, PodcastEpisode>()
  for (const term of terms.map((t) => t.trim()).filter(Boolean).slice(0, 2)) {
    const url = `https://itunes.apple.com/search?media=podcast&entity=podcastEpisode&limit=${perTerm}&term=${encodeURIComponent(term)}`
    for (const episode of parsePodcastEpisodes(await getJson(url))) {
      if (!found.has(episode.url)) found.set(episode.url, episode)
    }
  }
  return Array.from(found.values())
}

/** The show and episode ids in an Apple Podcasts episode address (…/id<show>?i=<episode>). */
export function appleEpisodeIds(url: string | null | undefined): { showId: string; trackId: string } | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!/(^|\.)podcasts\.apple\.com$/i.test(parsed.hostname)) return null
    const showId = parsed.pathname.match(/\/id(\d+)/)?.[1]
    const trackId = parsed.searchParams.get("i")
    return showId && trackId && /^\d+$/.test(trackId) ? { showId, trackId } : null
  } catch {
    return null
  }
}

/** A show in the directory, with its feed and the episodes the directory lists for it. */
export interface PodcastShow {
  name: string | null
  feedUrl: string | null
  episodes: PodcastEpisode[]
}

/** Read a show and its episodes out of an iTunes Lookup answer. */
export function parsePodcastShow(raw: unknown): PodcastShow | null {
  const results = list((raw as Json | null)?.results) as Json[]
  const show = results.find((item) => item.kind === "podcast" || item.wrapperType === "track")
  if (!show) return null
  return {
    name: str(show.collectionName),
    feedUrl: str(show.feedUrl),
    episodes: parsePodcastEpisodes(raw),
  }
}

/**
 * A show by its Apple id, with its most recent episodes (the directory
 * returns at most 200). Null when the directory doesn't know the show;
 * throws when it can't be reached.
 */
export async function lookUpPodcastShow(showId: string): Promise<PodcastShow | null> {
  return parsePodcastShow(
    await getJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(showId)}&entity=podcastEpisode&limit=200`)
  )
}

// ---------------------------------------------------------------------------
// Books: Open Library
// ---------------------------------------------------------------------------

export interface BookMention {
  title: string
  author?: string | null
}

export interface CatalogBook {
  /** The book's page on Open Library (the work, not one edition). */
  url: string
  title: string
  authors: string[]
  firstPublished: number | null
  imageUrl: string | null
}

interface BookDoc {
  key: string
  title: string
  authors: string[]
  year: number | null
  coverId: number | null
  editions: number
}

/** Lower case, no punctuation, accents or leading article, so titles can be compared. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an) /, "")
}

// "Zero to One: Notes on Startups" is the book people call "Zero to One"
function mainTitle(title: string): string {
  return normalizeTitle(title.split(/[:(–—]| - /)[0])
}

function sameTitle(a: string, b: string): boolean {
  const [fullA, fullB, mainA, mainB] = [normalizeTitle(a), normalizeTitle(b), mainTitle(a), mainTitle(b)]
  if (!fullA || !fullB) return false
  return fullA === fullB || mainA === fullB || fullA === mainB || (mainA === mainB && mainA.length > 0)
}

const nameWords = (name: string) => normalizeTitle(name).split(" ").filter((word) => word.length > 1)

/**
 * The surnames in an author mention: one per person in "Ichiro Kishimi and
 * Fumitake Koga". The surname is what a mention reliably gets right
 * ("Rhodes", "R. Rhodes", "Richard Rhodes"), and what a catalog spells the
 * same way ("W.A. Mathieu" is filed as "W. A. Mathieu").
 */
export function authorSurnames(mentioned: string): string[] {
  return mentioned
    .split(/,|&|\band\b|\bwith\b/i)
    .map((person) => nameWords(person).pop())
    .filter((surname): surname is string => !!surname)
}

function sameAuthor(mentioned: string, authors: string[]): boolean {
  const surnames = authorSurnames(mentioned)
  return surnames.length > 0 && authors.some((author) => nameWords(author).some((word) => surnames.includes(word)))
}

function parseBookDocs(raw: unknown): BookDoc[] {
  const docs: BookDoc[] = []
  for (const entry of list((raw as Json | null)?.docs)) {
    const doc = entry as Json
    const key = str(doc.key)
    const title = str(doc.title)
    if (!key?.startsWith("/works/") || !title) continue
    docs.push({
      key,
      title,
      authors: list(doc.author_name).filter((name): name is string => typeof name === "string"),
      year: typeof doc.first_publish_year === "number" ? doc.first_publish_year : null,
      coverId: typeof doc.cover_i === "number" ? doc.cover_i : null,
      editions: typeof doc.edition_count === "number" ? doc.edition_count : 0,
    })
  }
  return docs
}

// Without an author to check, a title alone has to be a well-established book
const MIN_EDITIONS_WITHOUT_AUTHOR = 3

/**
 * The catalog entry for a mentioned book, picked from an Open Library
 * search answer: the title has to match and, when the mention names an
 * author, so does the author. Among matches the work with the most editions
 * wins, which is the book itself over a study guide or a summary of it.
 */
export function matchBook(mention: BookMention, raw: unknown): CatalogBook | null {
  const author = mention.author?.trim()
  const matches = parseBookDocs(raw).filter(
    (doc) =>
      sameTitle(mention.title, doc.title) &&
      (author ? sameAuthor(author, doc.authors) : doc.editions >= MIN_EDITIONS_WITHOUT_AUTHOR)
  )
  const best = matches.sort((a, b) => b.editions - a.editions)[0]
  if (!best) return null
  return {
    url: `https://openlibrary.org${best.key}`,
    title: best.title,
    authors: best.authors.slice(0, 3),
    firstPublished: best.year,
    imageUrl: best.coverId ? `https://covers.openlibrary.org/b/id/${best.coverId}-M.jpg` : null,
  }
}

/**
 * Look a mentioned book up in Open Library. Null when nothing matches;
 * throws when it can't be reached.
 *
 * The catalog is asked up to three ways, narrowest first, because its
 * search is literal: a subtitle or a co-author it files differently hides
 * the book. Whatever comes back still has to pass matchBook.
 */
export async function findBook(mention: BookMention): Promise<CatalogBook | null> {
  const title = mention.title.trim()
  if (normalizeTitle(title).length < 2) return null
  const withoutSubtitle = title.split(/[:(–—]| - /)[0].trim()
  const surname = mention.author ? authorSurnames(mention.author)[0] : undefined

  const searches: Array<{ title: string; author?: string }> = [{ title, author: surname }]
  if (withoutSubtitle && withoutSubtitle !== title) searches.push({ title: withoutSubtitle, author: surname })
  if (surname) searches.push({ title: withoutSubtitle || title })

  for (const search of searches) {
    const params = new URLSearchParams({
      title: search.title,
      limit: "8",
      fields: "key,title,author_name,first_publish_year,cover_i,edition_count",
    })
    if (search.author) params.set("author", search.author)
    const match = matchBook(mention, await getJson(`https://openlibrary.org/search.json?${params}`, 15_000))
    if (match) return match
  }
  return null
}
