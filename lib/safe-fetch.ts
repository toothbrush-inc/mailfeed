/**
 * fetch() for URLs that come from users or their email. Refuses to connect to
 * loopback, private, link-local and other internal addresses, so a link can't
 * make the server read its own metadata endpoint or services on its network.
 *
 * The check runs when each connection is opened (every redirect hop included),
 * against the address actually dialled: hostnames are checked after DNS
 * resolution, so a name that resolves to a private address — or re-resolves to
 * one later (DNS rebinding) — is refused too.
 *
 * MAILFEED_ALLOW_PRIVATE_FETCH=true turns the check off, for local development
 * and tests only.
 */

import dns from "node:dns"
import net from "node:net"
import { Agent, buildConnector, fetch as undiciFetch } from "undici"

export const BLOCKED_FETCH_ERROR = "Blocked: address is on a private network"

function blockedMessage(detail: string): string {
  return `${BLOCKED_FETCH_ERROR} (${detail})`
}

export class BlockedFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "BlockedFetchError"
  }
}

function privateFetchAllowed(): boolean {
  return process.env.MAILFEED_ALLOW_PRIVATE_FETCH === "true"
}

// [first address, prefix length] of IPv4 ranges that are not the public internet
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network", unspecified
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
]

function v4ToInt(ip: string): number {
  return ip.split(".").reduce((n, part) => n * 256 + Number(part), 0)
}

function isBlockedV4(n: number): boolean {
  return BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits)
    const start = v4ToInt(base)
    return n >= start && n < start + size
  })
}

/** The eight 16-bit groups of an IPv6 address, or null if it isn't one. */
function parseV6(ip: string): number[] | null {
  const addr = ip.split("%")[0] // drop a zone id (fe80::1%en0)
  if (!net.isIPv6(addr)) return null
  let text = addr
  // Rewrite a dotted IPv4 tail (::ffff:1.2.3.4) as two hex groups
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const n = v4ToInt(dotted[1])
    text = text.slice(0, -dotted[1].length) + `${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`
  }
  const [head, rest] = text.includes("::") ? text.split("::") : [text, undefined]
  const toGroups = (s: string) => (s ? s.split(":").map((g) => parseInt(g, 16)) : [])
  const headGroups = toGroups(head)
  const restGroups = rest === undefined ? [] : toGroups(rest)
  const missing = 8 - headGroups.length - restGroups.length
  if (missing < 0 || (rest === undefined && missing !== 0)) return null
  return [...headGroups, ...new Array<number>(rest === undefined ? 0 : missing).fill(0), ...restGroups]
}

function isBlockedV6(g: number[]): boolean {
  const embeddedV4 = (hi: number, lo: number) => hi * 65536 + lo
  const allZero = (from: number, to: number) => g.slice(from, to).every((x) => x === 0)

  // ::ffff:a.b.c.d (IPv4-mapped) and ::a.b.c.d (IPv4-compatible, also covers :: and ::1)
  if (allZero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return isBlockedV4(embeddedV4(g[6], g[7]))
  // 64:ff9b::a.b.c.d (NAT64)
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return isBlockedV4(embeddedV4(g[6], g[7]))
  // 2002:aabb:ccdd:: (6to4 carries an IPv4 address)
  if (g[0] === 0x2002) return isBlockedV4(embeddedV4(g[1], g[2]))
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true // ff00::/8 multicast
  return false
}

/**
 * Whether an IP address (v4 or v6, brackets allowed) must not be fetched.
 * Anything that isn't a valid IP counts as blocked.
 */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, "")
  if (net.isIPv4(addr)) return isBlockedV4(v4ToInt(addr))
  const groups = parseV6(addr)
  return groups ? isBlockedV6(groups) : true
}

/**
 * Checks a URL without any network access: http(s) only, and an IP-literal
 * host must be public. Returns an error message, or null if it may be fetched.
 * Hostnames are checked later, when they are resolved.
 */
export function checkFetchUrl(url: string | URL): string | null {
  let parsed: URL
  try {
    parsed = typeof url === "string" ? new URL(url) : url
  } catch {
    return "Invalid URL"
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `Only http and https URLs can be fetched (got ${parsed.protocol})`
  }
  if (privateFetchAllowed()) return null
  // WHATWG URL already turns 2130706433, 0x7f.1 and 017700000001 into 127.0.0.1
  const host = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "")
  if (net.isIP(host) && isBlockedAddress(host)) return blockedMessage(host)
  if (host === "localhost" || host.endsWith(".localhost")) return blockedMessage(host)
  return null
}

/**
 * checkFetchUrl plus a DNS lookup of the hostname, for rejecting a URL up
 * front. A name that doesn't resolve is let through; the fetch reports that.
 */
export async function checkFetchUrlResolved(url: string): Promise<string | null> {
  const error = checkFetchUrl(url)
  if (error || privateFetchAllowed()) return error
  const host = new URL(url).hostname.replace(/^\[|\]$/g, "")
  if (net.isIP(host)) return null
  try {
    const addresses = await dns.promises.lookup(host, { all: true })
    const blocked = addresses.find((a) => isBlockedAddress(a.address))
    return blocked ? blockedMessage(`${host} -> ${blocked.address}`) : null
  } catch {
    return null
  }
}

type IsBlocked = (ip: string) => boolean

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number
) => void

/** dns.lookup that fails when any address the name resolves to is blocked. */
function makeLookup(isBlocked: IsBlocked) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, [])
      if (!privateFetchAllowed()) {
        const blocked = addresses.find((a) => isBlocked(a.address))
        if (blocked) return callback(new BlockedFetchError(blockedMessage(`${hostname} -> ${blocked.address}`)), [])
      }
      if (options.all) return callback(null, addresses)
      const first = addresses[0]
      callback(null, first.address, first.family)
    })
  }
}

/**
 * An undici Agent that checks every connection it opens. IP-literal hosts
 * skip DNS, so they are checked here; hostnames are checked in the lookup,
 * on the addresses the socket will actually connect to.
 */
export function createSafeAgent(isBlocked: IsBlocked = isBlockedAddress): Agent {
  const connect = buildConnector({ lookup: makeLookup(isBlocked) } as buildConnector.BuildOptions)
  return new Agent({
    connect: (opts, callback) => {
      if (!privateFetchAllowed()) {
        const host = opts.hostname.replace(/^\[|\]$/g, "")
        if (net.isIP(host) && isBlocked(host)) {
          return callback(new BlockedFetchError(blockedMessage(host)), null)
        }
      }
      return connect(opts, callback)
    },
  })
}

const defaultAgent = createSafeAgent()

export type SafeFetchInit = Parameters<typeof undiciFetch>[1]

/**
 * fetch() that refuses private addresses on the first request and on every
 * redirect. Redirects are still followed as usual (response.url is the final
 * URL). A refused fetch rejects with a BlockedFetchError.
 */
export async function safeFetch(
  url: string,
  init?: SafeFetchInit,
  agent: Agent = defaultAgent
): Promise<Response> {
  const error = checkFetchUrl(url)
  if (error) throw error.startsWith(BLOCKED_FETCH_ERROR) ? new BlockedFetchError(error) : new Error(error)
  try {
    // undici's Response is the one Node's global fetch returns; typed as the
    // global one so callers keep their existing types (e.g. json(): any)
    return (await undiciFetch(url, { ...init, dispatcher: agent })) as unknown as Response
  } catch (err) {
    // undici wraps connection errors as TypeError("fetch failed", { cause })
    const cause = err instanceof Error ? err.cause : undefined
    if (cause instanceof BlockedFetchError) throw cause
    throw err
  }
}
