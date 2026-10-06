/**
 * One clean form for a web address, so the same page reached through
 * different share links is one link: tracking parameters removed, nothing
 * that changes which page it is.
 *
 * Every link is stored and compared in this form (hashUrl() in
 * lib/link-extractor.ts hashes it). No Node or DOM dependency: the Media
 * page's client code imports lib/media.ts, which imports this.
 */

/**
 * Parameters that only record where a click came from, on any site.
 * "ref" and "source" are on the list because they always have been here,
 * though a few sites give them a meaning of their own.
 */
const TRACKING_PARAMS = new Set([
  // Campaign tags (the rest of the utm_ family is matched by prefix)
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "ref", "source", "ref_src", "ref_url",
  // Ad click ids
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid", "twclid", "ttclid",
  "li_fat_id", "srsltid", "rb_clickid", "wickedid",
  // Email and marketing tools
  "mc_cid", "mc_eid", "_hsenc", "_hsmi", "__hssc", "__hstc", "__hsfp", "hsCtaTracking", "mkt_tok",
  "vero_id", "vero_conv", "oly_enc_id", "oly_anon_id", "s_cid",
  // Analytics hand-offs
  "_ga", "_gl", "_openstat", "guccounter", "guce_referrer", "guce_referrer_sig",
  // Share ids
  "igshid", "igsh", "share_id", "share_user_id",
])

const TRACKING_PREFIXES = ["utm_", "pk_", "mtm_", "hsa_"]

interface HostRule {
  /** Hostname or parent domain. */
  host: string
  params?: string[]
  prefixes?: string[]
}

/**
 * Parameters that are tracking on one site and may mean something on
 * another: "t" is who shared a post on X and where a video starts on
 * YouTube; "s" is a share source on X and the search box on a blog.
 */
const HOST_RULES: HostRule[] = [
  { host: "x.com", params: ["s", "t", "cxt"] },
  { host: "twitter.com", params: ["s", "t", "cxt"] },
  { host: "youtube.com", params: ["si", "feature", "pp", "ab_channel"] },
  { host: "youtu.be", params: ["si", "feature", "pp"] },
  { host: "spotify.com", params: ["si", "nd"] },
  { host: "apple.com", params: ["uo", "itsct", "itscg", "at", "ct", "mt", "ls", "app"] },
  { host: "linkedin.com", params: ["trk", "trackingId", "refId", "lipi", "midToken", "midSig", "trkEmail"] },
  { host: "tiktok.com", params: ["_r", "_t", "is_from_webapp", "sender_device", "is_copy_url", "web_id"] },
  { host: "reddit.com", params: ["rdt", "correlation_id"] },
]

export const AMAZON_HOST = /(^|\.)amazon\.(com|ca|de|fr|es|it|nl|se|pl|in|sg|ae|sa|eg|co\.uk|co\.jp|com\.au|com\.br|com\.mx|com\.tr|com\.be)$/i

// Affiliate, referral and search-trail parameters on Amazon pages
const AMAZON_PARAMS = [
  "tag", "linkCode", "linkId", "ref_", "camp", "creative", "creativeASIN", "ascsubtag",
  "_encoding", "content-id", "dib", "dib_tag", "crid", "sprefix", "qid", "sr", "ie", "smid", "spLa",
]
const AMAZON_PREFIXES = ["pd_rd_", "pf_rd_", "asc_"]

function matchesHost(hostname: string, host: string): boolean {
  return hostname === host || hostname.endsWith(`.${host}`)
}

// Decode HTML entities in URLs (e.g., &amp; → &)
function decodeHtmlEntities(url: string): string {
  return url
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
}

/** Remove tracking from a parsed address, in place. */
function stripTracking(parsed: URL): void {
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "")
  const params = new Set(TRACKING_PARAMS)
  const prefixes = [...TRACKING_PREFIXES]

  for (const rule of HOST_RULES) {
    if (!matchesHost(hostname, rule.host)) continue
    rule.params?.forEach((param) => params.add(param))
    prefixes.push(...(rule.prefixes ?? []))
  }
  if (AMAZON_HOST.test(hostname)) {
    AMAZON_PARAMS.forEach((param) => params.add(param))
    prefixes.push(...AMAZON_PREFIXES)
    // …/dp/054792822X/ref=sr_1_1 is the same product as …/dp/054792822X
    parsed.pathname = parsed.pathname.replace(/\/ref=[^/]*/g, "") || "/"
  }

  for (const name of Array.from(parsed.searchParams.keys())) {
    if (params.has(name) || prefixes.some((prefix) => name.startsWith(prefix))) {
      parsed.searchParams.delete(name)
    }
  }
}

/** The clean form of an address, or null when it isn't one. */
export function normalizeUrl(url: string): string | null {
  try {
    // First, decode any HTML entities in the URL
    const parsed = new URL(decodeHtmlEntities(url))

    stripTracking(parsed)

    // Remove trailing slash for consistency
    let normalized = parsed.toString()
    if (normalized.endsWith("/") && parsed.pathname !== "/") {
      normalized = normalized.slice(0, -1)
    }

    return normalized
  } catch {
    return null
  }
}

/** The clean form of an address, or the address unchanged when it can't be parsed. */
export function cleanUrl(url: string): string {
  return normalizeUrl(url) ?? url
}
