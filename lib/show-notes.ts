/**
 * The show notes of a podcast episode: the description the show publishes
 * with it, which usually links what the episode discusses.
 *
 * A podcast directory page shows that description as plain text. The links
 * are in the show's RSS feed, so that is where they are read from:
 *
 *   episode link ──► Apple's directory (the show's feed, the episode's id)
 *                ──► the feed ──► the episode's <item> ──► its notes ──► links
 *
 * Everything returned is what the show itself wrote. Which of the links
 * are about the episode, and which are sponsors or "subscribe" links, is
 * decided afterwards (lib/media-lookup.ts).
 */

import { JSDOM } from "jsdom"
import {
  appleEpisodeIds,
  lookUpPodcastShow,
  normalizeTitle,
  searchPodcastEpisodes,
  type PodcastEpisode,
} from "@/lib/catalogs"
import { safeFetch } from "@/lib/safe-fetch"

export interface ShowNoteLink {
  url: string
  /** The link's text in the notes, or the address when it was written out bare. */
  text: string
}

export interface ShowNotes {
  show: string | null
  episode: string
  /** The notes as plain text. */
  text: string
  links: ShowNoteLink[]
}

const MAX_FEED_BYTES = 40_000_000
const MAX_LINKS = 60

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** The text of an XML element: out of its CDATA wrapper, or with its entities decoded. */
function elementText(body: string): string {
  const cdata = body.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/)
  return cdata ? cdata[1] : decodeEntities(body)
}

function element(itemXml: string, tag: string): string | null {
  const match = itemXml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  return match ? elementText(match[1]).trim() : null
}

/**
 * The <item> of one episode in a feed, found by its guid or, failing that,
 * by its exact title. Works on the feed as text: feeds run to tens of
 * megabytes and only one item is wanted.
 */
export function findFeedItem(feedXml: string, episode: { guid?: string | null; title?: string | null }): string | null {
  const itemAround = (index: number) => {
    const start = feedXml.lastIndexOf("<item", index)
    const end = feedXml.indexOf("</item>", index)
    return start >= 0 && end > start ? feedXml.slice(start, end + "</item>".length) : null
  }

  if (episode.guid) {
    // A guid can sit in CDATA or have its ampersands escaped
    for (const needle of [episode.guid, episode.guid.replace(/&/g, "&amp;")]) {
      let index = feedXml.indexOf(needle)
      while (index >= 0) {
        const item = itemAround(index)
        if (item && element(item, "guid") === episode.guid) return item
        index = feedXml.indexOf(needle, index + needle.length)
      }
    }
  }

  const wanted = episode.title ? normalizeTitle(episode.title) : ""
  if (wanted) {
    const items = feedXml.matchAll(/<item[\s>][\s\S]*?<\/item>/g)
    for (const [item] of items) {
      const title = element(item, "itunes:title") ?? element(item, "title")
      if (title && normalizeTitle(title) === wanted) return item
      const plainTitle = element(item, "title")
      if (plainTitle && normalizeTitle(plainTitle) === wanted) return item
    }
  }
  return null
}

const BARE_URL = /https?:\/\/[^\s<>"')\]]+/g

/** The links in an episode's notes, each address once, with the text it was given. */
export function linksInShowNotes(notesHtml: string): { text: string; links: ShowNoteLink[] } {
  // Notes whose markup was escaped twice arrive as text full of &lt;a href=…&gt;
  const html = !/<a\s/i.test(notesHtml) && /&lt;a\s/i.test(notesHtml) ? decodeEntities(notesHtml) : notesHtml
  const document = new JSDOM(`<body>${html}</body>`).window.document
  const links = new Map<string, ShowNoteLink>()
  const add = (raw: string | null, text: string) => {
    if (!raw || links.size >= MAX_LINKS) return
    let url: URL
    try {
      url = new URL(raw.trim())
    } catch {
      return
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return
    const key = url.toString()
    if (!links.has(key)) links.set(key, { url: key, text: text.replace(/\s+/g, " ").trim().slice(0, 160) || key })
  }

  for (const anchor of Array.from(document.querySelectorAll("a[href]"))) {
    add(anchor.getAttribute("href"), anchor.textContent || "")
  }
  // Block elements run together in textContent; keep them on separate lines
  for (const block of Array.from(document.querySelectorAll("p, li, br, div, h1, h2, h3, h4"))) {
    block.insertAdjacentText(block.tagName === "BR" ? "beforebegin" : "afterend", "\n")
  }
  const text = (document.body.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim()
  // Addresses written out without a link
  for (const bare of text.match(BARE_URL) ?? []) add(bare.replace(/[.,;:!?]+$/, ""), "")

  return { text, links: Array.from(links.values()) }
}

/** The notes of one episode, read from its <item> in the feed. */
export function parseShowNotes(itemXml: string, show: string | null): ShowNotes | null {
  const title = element(itemXml, "itunes:title") ?? element(itemXml, "title")
  // content:encoded is the full notes where a feed has it; description can be a cut-down copy
  const candidates = ["content:encoded", "description", "itunes:summary"]
    .map((tag) => element(itemXml, tag))
    .filter((body): body is string => !!body)
  const notes = candidates.sort((a, b) => b.length - a.length)[0]
  if (!title || !notes) return null
  return { show, episode: title, ...linksInShowNotes(notes) }
}

async function fetchFeed(feedUrl: string): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 25_000)
  try {
    const response = await safeFetch(feedUrl, {
      headers: {
        "User-Agent": "MailFeed/1.0 (https://github.com/toothbrush-inc/mailfeed)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
      redirect: "follow",
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`The show's feed answered ${response.status}`)
    if (Number(response.headers.get("content-length") ?? 0) > MAX_FEED_BYTES) {
      throw new Error("The show's feed is too large to read")
    }
    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

interface EpisodeLink {
  url: string
  finalUrl?: string | null
  title?: string | null
}

// "Costco - Acquired | Podcast on Spotify", "Costco – Acquired – Apple Podcasts"
function titleCandidates(title: string): string[] {
  const withoutSite = title.replace(/\s*[|–—-]\s*(Podcast on Spotify|Apple Podcasts|Spotify|Overcast|Pocket Casts).*$/i, "").trim()
  const firstPart = withoutSite.split(/\s+[–—-]\s+/)[0]?.trim()
  return Array.from(new Set([title.trim(), withoutSite, firstPart].filter((part): part is string => !!part)))
}

/**
 * Where an episode link's notes are: the show's feed and the episode's
 * guid or title in it. An Apple Podcasts address carries the ids to look
 * them up. For any other podcast page the directory is searched by the
 * page's title, and only an episode with exactly that title is accepted.
 */
async function locateEpisode(link: EpisodeLink): Promise<Pick<PodcastEpisode, "feedUrl" | "guid" | "title" | "show"> | null> {
  const ids = appleEpisodeIds(link.finalUrl) ?? appleEpisodeIds(link.url)
  if (ids) {
    const show = await lookUpPodcastShow(ids.showId)
    if (!show?.feedUrl) return null
    const listed = show.episodes.find((episode) => episode.trackId === ids.trackId)
    if (listed) return { feedUrl: show.feedUrl, guid: listed.guid, title: listed.title, show: show.name }
    // Older than the episodes the directory lists: the feed is searched by title instead
    const title = link.title ? titleCandidates(link.title)[0] : null
    return title ? { feedUrl: show.feedUrl, guid: null, title, show: show.name } : null
  }

  if (!link.title) return null
  const titles = titleCandidates(link.title)
  const wanted = new Set(titles.map(normalizeTitle).filter((title) => title.length >= 4))
  const found = await searchPodcastEpisodes([titles[titles.length - 1]], 15)
  const match = found.find((episode) => episode.feedUrl && wanted.has(normalizeTitle(episode.title)))
  return match ?? null
}

/**
 * The show notes of the episode a link points at. Null when the episode
 * or its notes can't be located; throws when the directory or the feed
 * can't be reached.
 */
export async function fetchShowNotes(link: EpisodeLink): Promise<ShowNotes | null> {
  const located = await locateEpisode(link)
  if (!located?.feedUrl) return null
  const item = findFeedItem(await fetchFeed(located.feedUrl), located)
  return item ? parseShowNotes(item, located.show) : null
}
