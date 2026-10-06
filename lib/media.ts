/**
 * Which links are media: a video, a podcast, a book or a game.
 *
 * A link's media type is derived, never stored, so changing a rule here
 * changes the Media page straight away with nothing to backfill. The URL
 * decides first (a YouTube watch page is a video whatever the analysis
 * said). The AI's link tags are the fallback for sites no rule knows about.
 */

import { AMAZON_HOST, cleanUrl } from "./clean-url"

export const MEDIA_TYPES = ["video", "podcast", "book", "game"] as const
export type MediaType = (typeof MEDIA_TYPES)[number]

export function isMediaType(value: string | null | undefined): value is MediaType {
  return !!value && (MEDIA_TYPES as readonly string[]).includes(value)
}

interface HostRule {
  /** Hostname or parent domain: "itch.io" also matches "someone.itch.io". */
  host: string
  type: MediaType
  /** Tested against pathname + search. Omitted: any page on the host that isn't the home page. */
  path?: RegExp
  /** Only subdomains count, never the bare host (someone.itch.io, not itch.io). */
  subdomainOnly?: boolean
}

// First match wins, so a narrower rule goes above a broader one on the same host.
const HOST_RULES: HostRule[] = [
  // --- Videos ---
  // Watch pages only: channels and the home page aren't a video.
  { host: "youtube.com", type: "video", path: /^\/(watch\?|shorts\/|live\/|embed\/|v\/|clip\/|playlist\?)/i },
  { host: "youtube-nocookie.com", type: "video", path: /^\/embed\//i },
  { host: "youtu.be", type: "video" },
  { host: "vimeo.com", type: "video", path: /\/\d{6,}/ },
  { host: "clips.twitch.tv", type: "video" },
  { host: "twitch.tv", type: "video", path: /^\/(videos\/\d+|[^/]+\/clip\/)/i },
  { host: "dailymotion.com", type: "video", path: /^\/video\//i },
  { host: "dai.ly", type: "video" },
  { host: "ted.com", type: "video", path: /^\/talks\//i },
  { host: "tiktok.com", type: "video", path: /^\/(@[^/]+\/video\/|t\/)/i },
  { host: "vm.tiktok.com", type: "video" },
  { host: "vt.tiktok.com", type: "video" },
  { host: "instagram.com", type: "video", path: /^\/([^/]+\/)?(reel|reels|tv)\//i },
  { host: "fb.watch", type: "video" },
  { host: "facebook.com", type: "video", path: /^\/(watch\/?\?|[^/]+\/videos\/|reel\/)/i },
  { host: "loom.com", type: "video", path: /^\/(share|embed)\//i },
  { host: "rumble.com", type: "video", path: /^\/(v[a-z0-9]+-|embed\/)/i },
  { host: "odysee.com", type: "video", path: /^\/@[^/]+\/[^/]+/ },
  { host: "nebula.tv", type: "video", path: /^\/videos\//i },
  { host: "bilibili.com", type: "video", path: /^\/video\//i },
  { host: "b23.tv", type: "video" },
  { host: "nicovideo.jp", type: "video", path: /^\/watch\//i },
  { host: "streamable.com", type: "video" },
  { host: "media.ccc.de", type: "video", path: /^\/v\//i },
  { host: "c-span.org", type: "video", path: /^\/(video|program)\//i },

  // --- Podcasts ---
  { host: "podcasts.apple.com", type: "podcast" },
  { host: "open.spotify.com", type: "podcast", path: /^\/(intl-[a-z]+\/)?(episode|show)\//i },
  { host: "podcasters.spotify.com", type: "podcast", path: /^\/pod\//i },
  { host: "creators.spotify.com", type: "podcast", path: /^\/pod\//i },
  { host: "anchor.fm", type: "podcast" },
  { host: "overcast.fm", type: "podcast" },
  { host: "pca.st", type: "podcast" },
  { host: "pocketcasts.com", type: "podcast", path: /^\/(podcasts?|episode)\//i },
  { host: "castro.fm", type: "podcast", path: /^\/(episode|podcast)\//i },
  { host: "podcasts.google.com", type: "podcast" },
  { host: "music.amazon.com", type: "podcast", path: /^\/podcasts\//i },
  { host: "audible.com", type: "podcast", path: /^\/podcast\//i },
  { host: "pod.link", type: "podcast" },
  { host: "podfollow.com", type: "podcast" },
  { host: "plinkhq.com", type: "podcast" },
  { host: "transistor.fm", type: "podcast", subdomainOnly: true },
  { host: "simplecast.com", type: "podcast", subdomainOnly: true },
  { host: "buzzsprout.com", type: "podcast", subdomainOnly: true },
  { host: "buzzsprout.com", type: "podcast", path: /^\/\d+/ },
  { host: "libsyn.com", type: "podcast", subdomainOnly: true },
  { host: "podbean.com", type: "podcast", subdomainOnly: true },
  { host: "captivate.fm", type: "podcast", subdomainOnly: true },
  { host: "acast.com", type: "podcast", subdomainOnly: true },
  { host: "megaphone.fm", type: "podcast", subdomainOnly: true },
  { host: "omny.fm", type: "podcast", path: /^\/shows\//i },
  { host: "art19.com", type: "podcast", path: /^\/shows\//i },
  { host: "spreaker.com", type: "podcast", path: /^\/(podcast|episode|show|user)\//i },
  { host: "redcircle.com", type: "podcast", path: /^\/shows\//i },
  { host: "audioboom.com", type: "podcast", path: /^\/(posts|channels)\//i },
  { host: "castbox.fm", type: "podcast" },
  { host: "player.fm", type: "podcast", path: /^\/series\//i },
  { host: "stitcher.com", type: "podcast", path: /^\/(show|podcast)\//i },
  { host: "podchaser.com", type: "podcast", path: /^\/podcasts\//i },
  { host: "listennotes.com", type: "podcast", path: /^\/(podcasts|clips)\//i },
  { host: "snipd.com", type: "podcast", path: /^\/(episode|show|snip)\//i },
  { host: "podcastaddict.com", type: "podcast" },
  { host: "iheart.com", type: "podcast", path: /^\/podcast\//i },
  { host: "tunein.com", type: "podcast", path: /^\/podcasts\//i },
  { host: "bbc.co.uk", type: "podcast", path: /^\/sounds\//i },

  // --- Books ---
  { host: "goodreads.com", type: "book", path: /^\/([a-z]{2}\/)?book\//i },
  { host: "audible.com", type: "book", path: /^\/pd\//i },
  { host: "libro.fm", type: "book", path: /^\/audiobooks\//i },
  { host: "books.google.com", type: "book" },
  { host: "google.com", type: "book", path: /^\/books\/(edition|about)\//i },
  { host: "books.apple.com", type: "book", path: /\/(book|audiobook)\//i },
  { host: "bookshop.org", type: "book", path: /^\/(p\/)?books\//i },
  { host: "openlibrary.org", type: "book", path: /^\/(books|works)\//i },
  { host: "gutenberg.org", type: "book", path: /^\/(ebooks|files)\/\d+/i },
  { host: "standardebooks.org", type: "book", path: /^\/ebooks\/[^/]+\/[^/]+/i },
  { host: "barnesandnoble.com", type: "book", path: /^\/w\//i },
  { host: "kobo.com", type: "book", path: /\/(ebook|audiobook)\//i },
  { host: "thestorygraph.com", type: "book", path: /^\/books\//i },
  { host: "librarything.com", type: "book", path: /^\/work\//i },
  { host: "worldcat.org", type: "book", path: /\/(title|oclc)\//i },
  { host: "isbnsearch.org", type: "book", path: /^\/isbn\//i },
  { host: "oreilly.com", type: "book", path: /^\/library\/view\//i },
  { host: "manning.com", type: "book", path: /^\/books\//i },
  { host: "pragprog.com", type: "book", path: /^\/titles\//i },
  { host: "nostarch.com", type: "book", path: /^\/(?!blog|catalog|about|contact|search)[a-z0-9-]+\/?$/i },
  { host: "leanpub.com", type: "book", path: /^\/(?!u\/|bookstore|pricing|authors|podcasts|manifesto)[a-z0-9_-]+\/?(\?.*)?$/i },
  { host: "press.stripe.com", type: "book" },
  { host: "penguinrandomhouse.com", type: "book", path: /^\/books\//i },
  { host: "penguin.co.uk", type: "book", path: /^\/books\//i },
  { host: "simonandschuster.com", type: "book", path: /^\/books\//i },
  { host: "macmillan.com", type: "book", path: /^\/books\//i },
  { host: "harpercollins.com", type: "book", path: /^\/products\//i },
  { host: "hachettebookgroup.com", type: "book", path: /^\/titles\//i },
  { host: "wwnorton.com", type: "book", path: /^\/books\//i },
  { host: "press.princeton.edu", type: "book", path: /^\/books\//i },
  { host: "mitpress.mit.edu", type: "book", path: /^\/97[89]\d{10}\//i },
  { host: "hup.harvard.edu", type: "book", path: /^\/books\//i },
  { host: "press.uchicago.edu", type: "book", path: /^\/ucp\/books\/book\//i },
  { host: "yalebooks.yale.edu", type: "book", path: /^\/book\//i },
  { host: "link.springer.com", type: "book", path: /^\/book\//i },

  // --- Games ---
  { host: "store.steampowered.com", type: "game", path: /^\/(app|bundle|sub)\//i },
  { host: "steamcommunity.com", type: "game", path: /^\/app\//i },
  { host: "s.team", type: "game", path: /^\/a\//i },
  { host: "itch.io", type: "game", subdomainOnly: true },
  { host: "store.epicgames.com", type: "game", path: /^\/([a-z]{2}(-[a-z]{2})?\/)?p\//i },
  { host: "epicgames.com", type: "game", path: /^\/store\/([a-z]{2}(-[a-z]{2})?\/)?p\//i },
  { host: "gog.com", type: "game", path: /^\/([a-z]{2}\/)?game\//i },
  { host: "nintendo.com", type: "game", path: /\/store\/products\//i },
  { host: "store.playstation.com", type: "game", path: /\/(product|concept)\//i },
  { host: "playstation.com", type: "game", path: /^\/([a-z]{2}-[a-z]{2}\/)?games\/[^/]+/i },
  { host: "xbox.com", type: "game", path: /\/games\/(store\/)?[^/]+/i },
  { host: "humblebundle.com", type: "game", path: /^\/store\/[^/]+/i },
  { host: "meta.com", type: "game", path: /^\/experiences\//i },
  { host: "boardgamegeek.com", type: "game", path: /^\/(boardgame|videogame)\//i },
  { host: "roblox.com", type: "game", path: /^\/games\/\d+/i },
  { host: "newgrounds.com", type: "game", path: /^\/portal\/view\//i },
  { host: "lexaloffle.com", type: "game", path: /^\/bbs\/\?(.*&)?(tid|pid)=/i },
  { host: "play.date", type: "game", path: /^\/games\/[^/]+/i },
  { host: "igdb.com", type: "game", path: /^\/games\//i },
  { host: "howlongtobeat.com", type: "game", path: /^\/game\//i },
  { host: "metacritic.com", type: "game", path: /^\/game\//i },
  { host: "opencritic.com", type: "game", path: /^\/game\//i },
  { host: "mobygames.com", type: "game", path: /^\/game\//i },
  { host: "rawg.io", type: "game", path: /^\/games\//i },
  { host: "backloggd.com", type: "game", path: /^\/games\//i },
  { host: "crazygames.com", type: "game", path: /^\/game\//i },
  { host: "poki.com", type: "game", path: /\/g\//i },
]

// Printed books are listed under their ISBN-10; everything else (Kindle
// editions included) gets a "B0…" ASIN, which the URL slug or the page
// title has to identify as a book.
const AMAZON_PRODUCT = /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})/i
const ISBN10 = /^\d{9}[\dX]$/i
const AMAZON_BOOK_SLUG = /[-/](ebook|audiobook)[-/]|\/kindle-store\//i
const AMAZON_BOOK_TITLE = /:\s*(Books|Kindle Store|Audible Books[^:]*)\s*$|\b(Kindle Edition|Paperback|Hardcover|Audible Audiobook|eBook)\b/i

// A "/podcast/" or "/podcasts/" section, or a podcast. subdomain, on any site
const PODCAST_PATH = /\/podcasts?(\/|$)/i
const PODCAST_SUBDOMAIN = /^podcasts?\./i
const VIDEO_FILE = /\.(mp4|m4v|webm|mov)$/i

function parse(url: string | null | undefined): URL | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null
  } catch {
    return null
  }
}

function bareHost(parsed: URL): string {
  return parsed.hostname.toLowerCase().replace(/^(www|m|mobile)\./, "")
}

function matchesHost(host: string, rule: HostRule): boolean {
  if (host === rule.host) return !rule.subdomainOnly
  return host.endsWith(`.${rule.host}`)
}

/** The media type a URL points at, judged by the URL alone. */
export function classifyMediaUrl(url: string | null | undefined, title?: string | null): MediaType | null {
  const parsed = parse(url)
  if (!parsed) return null

  const host = bareHost(parsed)
  const pathAndQuery = parsed.pathname + parsed.search
  const hasPage = parsed.pathname.length > 1 || parsed.search.length > 1

  for (const rule of HOST_RULES) {
    if (!matchesHost(host, rule)) continue
    if (rule.path ? rule.path.test(pathAndQuery) : hasPage) return rule.type
  }

  if (AMAZON_HOST.test(host)) {
    const asin = parsed.pathname.match(AMAZON_PRODUCT)?.[1]
    if (asin && ISBN10.test(asin)) return "book"
    if (asin && (AMAZON_BOOK_SLUG.test(parsed.pathname) || (title && AMAZON_BOOK_TITLE.test(title)))) {
      return "book"
    }
    return null
  }

  if (VIDEO_FILE.test(parsed.pathname)) return "video"
  if (PODCAST_SUBDOMAIN.test(host) && hasPage) return "podcast"
  if (PODCAST_PATH.test(parsed.pathname)) return "podcast"

  return null
}

export interface MediaLinkFields {
  url: string
  finalUrl?: string | null
  title?: string | null
  linkTags?: string[] | null
  contentTags?: string[] | null
}

export interface MediaClassification {
  type: MediaType
  /** "url": a URL rule matched. "ai": the analysis tagged it. */
  source: "url" | "ai"
}

const PODCAST_WORDS = /\b(podcast|episode)\b/i

/**
 * The media type of a stored link, or null for an ordinary page.
 * The URL the link ended up on is checked before the one that was shared,
 * so a shortened link (amzn.to, spotify.link) is judged by its destination.
 */
export function classifyMedia(link: MediaLinkFields): MediaClassification | null {
  const byUrl = classifyMediaUrl(link.finalUrl, link.title) ?? classifyMediaUrl(link.url, link.title)
  if (byUrl) return { type: byUrl, source: "url" }

  const tags = link.linkTags ?? []
  if (tags.includes("PODCAST")) return { type: "podcast", source: "ai" }
  if (tags.includes("BOOK")) return { type: "book", source: "ai" }
  if (tags.includes("GAME")) return { type: "game", source: "ai" }
  // An article with a clip embedded in it is tagged both ways; it stays an article.
  if (tags.includes("VIDEO") && !tags.includes("ARTICLE")) return { type: "video", source: "ai" }
  // Analyses from before the PODCAST tag existed only say AUDIO, which also covers music.
  if (
    tags.includes("AUDIO") &&
    !(link.contentTags ?? []).includes("MUSIC") &&
    PODCAST_WORDS.test(`${link.title ?? ""} ${link.finalUrl ?? link.url}`)
  ) {
    return { type: "podcast", source: "ai" }
  }

  return null
}

/** Link tags that can make a link media without any URL rule matching. */
export const MEDIA_LINK_TAGS = ["VIDEO", "AUDIO", "PODCAST", "BOOK", "GAME"] as const

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * POSIX regex (for Postgres `~*`) matching every hostname a URL rule could
 * apply to. A cheap first cut in SQL: rows that pass still go through
 * classifyMedia, which is the only thing that decides.
 */
export function mediaHostPattern(): string {
  const hosts = Array.from(new Set(HOST_RULES.map((rule) => escapeRegex(rule.host))))
  return `(^|\\.)(${hosts.join("|")}|amazon\\.[a-z.]+)$|^podcasts?\\.`
}

/** POSIX regex for URLs the path-based rules (not tied to a host) can match. */
export const MEDIA_URL_PATTERN = "/podcasts?(/|$|[?#])|\\.(mp4|m4v|webm|mov)($|[?#])"

/** The video id of a YouTube URL of any shape, or null. */
export function youtubeVideoId(url: string | null | undefined): string | null {
  const parsed = parse(url)
  if (!parsed) return null
  const host = bareHost(parsed).replace(/^music\./, "")
  let id: string | null = null
  if (host === "youtu.be") {
    id = parsed.pathname.split("/")[1] || null
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parsed.pathname === "/watch") id = parsed.searchParams.get("v")
    else id = parsed.pathname.match(/^\/(?:shorts|live|embed|v)\/([^/?#]+)/)?.[1] ?? null
  }
  return id && /^[\w-]{6,}$/.test(id) ? id : null
}

/**
 * One key per media item, so the same video shared as youtu.be/ID and as
 * youtube.com/watch?v=ID (or with different tracking parameters) is listed once.
 */
export function mediaKey(link: Pick<MediaLinkFields, "url" | "finalUrl">): string {
  const youtubeId = youtubeVideoId(link.finalUrl) ?? youtubeVideoId(link.url)
  if (youtubeId) return `youtube:${youtubeId}`

  const parsed = parse(link.finalUrl) ?? parse(link.url)
  if (!parsed) return link.finalUrl || link.url
  if (AMAZON_HOST.test(bareHost(parsed))) {
    const asin = parsed.pathname.match(AMAZON_PRODUCT)?.[1]
    if (asin) return `amazon:${asin.toUpperCase()}`
  }
  // The clean form of the address, with its parameters in a fixed order
  const cleaned = parse(cleanUrl(parsed.toString())) ?? parsed
  const params = new URLSearchParams(cleaned.search)
  params.sort()
  const query = params.toString()
  return `${bareHost(cleaned)}${cleaned.pathname.replace(/\/+$/, "")}${query ? `?${query}` : ""}`
}
