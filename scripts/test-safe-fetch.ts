/**
 * safeFetch refuses private/internal addresses: IP literals in every form,
 * hostnames that resolve to them, and redirects to them. No database needed;
 * everything runs against a local server, without internet access.
 *
 *   npx tsx scripts/test-safe-fetch.ts
 */
import { createServer } from "node:http"
import { fetch as undiciFetch } from "undici"
import type { AddressInfo } from "node:net"
import {
  BLOCKED_FETCH_ERROR,
  BlockedFetchError,
  checkFetchUrl,
  checkFetchUrlResolved,
  createSafeAgent,
  isBlockedAddress,
  safeFetch,
} from "../lib/safe-fetch"
import { fetchAndParseContent } from "../lib/content-fetcher"
import { classifyFetchError, isRetryableFetchError } from "../lib/link-buckets"
import { fetchWithFallbackChain } from "../lib/fetchers"
import "../lib/fetchers/direct"
import "../lib/fetchers/wayback"

delete process.env.MAILFEED_ALLOW_PRIVATE_FETCH

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? "")
  }
}

async function fetchError(url: string, agent?: ReturnType<typeof createSafeAgent>): Promise<unknown> {
  try {
    const res = await safeFetch(url, { signal: AbortSignal.timeout(5000) }, agent)
    return `no error (HTTP ${res.status}, ${res.url})`
  } catch (err) {
    return err
  }
}

function isBlockedError(err: unknown): boolean {
  return err instanceof BlockedFetchError && err.message.startsWith(BLOCKED_FETCH_ERROR)
}

async function main() {
  console.log("IP classifier")
  const blocked = [
    "127.0.0.1", "127.255.255.254", "0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "100.127.255.255", "224.0.0.1", "239.255.255.250", "255.255.255.255",
    "::", "::1", "[::1]", "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:a9fe:a9fe",
    "::127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::a9fe:a9fe", "2002:7f00:1::",
    "fe80::1", "fe80::1%en0", "febf::1", "fc00::1", "fd12:3456::1", "ff02::1",
    "not-an-ip",
  ]
  for (const ip of blocked) check(`${ip} is blocked`, isBlockedAddress(ip))
  const allowed = [
    "8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1", "100.63.255.255",
    "100.128.0.1", "169.253.0.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e",
    "::ffff:8.8.8.8", "2002:808:808::",
  ]
  for (const ip of allowed) check(`${ip} is allowed`, !isBlockedAddress(ip))

  console.log("URL checks (no network)")
  const blockedUrls = [
    "http://127.0.0.1/",
    "http://[::1]:8080/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/",
    "http://192.168.0.10/",
    "http://0.0.0.0:3000/",
    "http://2130706433/", // decimal 127.0.0.1
    "http://0x7f000001/", // hex
    "http://0x7f.1/",
    "http://017700000001/", // octal
    "http://127.1/",
    "http://localhost:3000/",
    "http://db.localhost/",
  ]
  for (const url of blockedUrls) {
    const error = checkFetchUrl(url)
    check(`${url} rejected (host parses as ${new URL(url).hostname})`, !!error?.startsWith(BLOCKED_FETCH_ERROR), error)
  }
  for (const url of ["file:///etc/passwd", "ftp://example.com/", "gopher://127.0.0.1/", "data:text/html,hi"]) {
    const error = checkFetchUrl(url)
    check(`${url} rejected as non-http`, !!error?.includes("Only http and https"), error)
  }
  check("invalid URL rejected", checkFetchUrl("not a url") === "Invalid URL")
  for (const url of ["https://example.com/article", "http://93.184.216.34/", "https://[2606:4700::1111]/"]) {
    check(`${url} passes`, checkFetchUrl(url) === null, checkFetchUrl(url))
  }

  console.log("Resolved-hostname check")
  const resolvedError = await checkFetchUrlResolved("http://localhost./")
  check("localhost. rejected up front", !!resolvedError?.startsWith(BLOCKED_FETCH_ERROR), resolvedError)
  check(
    "a name that doesn't resolve is left to the fetch",
    (await checkFetchUrlResolved("http://does-not-exist.invalid/")) === null
  )

  console.log("safeFetch")
  for (const url of ["http://127.0.0.1:9/", "http://[::1]:9/", "http://2130706433:9/", "http://169.254.169.254/"]) {
    const err = await fetchError(url)
    check(`${url} blocked before connecting`, isBlockedError(err), err)
  }
  // Straight to the agent, skipping safeFetch's name check, so this exercises
  // the DNS lookup at connect time (what stops DNS rebinding)
  const lookupAgent = createSafeAgent()
  const dnsErr = await undiciFetch("http://localhost:59999/", { dispatcher: lookupAgent }).then(
    (res) => `no error (HTTP ${res.status})`,
    (err) => (err instanceof Error && err.cause) || err
  )
  check("hostname resolving to loopback blocked at connect time", isBlockedError(dnsErr), dnsErr)
  await lookupAgent.close()
  const protoErr = await fetchError("file:///etc/passwd")
  check("file: URL refused", protoErr instanceof Error && protoErr.message.includes("Only http and https"), protoErr)

  // A local server stands in for a public site: this agent treats 127.0.0.1
  // as public and every other private address as blocked.
  const server = createServer((req, res) => {
    const port = (server.address() as AddressInfo).port
    const redirects: Record<string, string> = {
      "/to-metadata": "http://169.254.169.254/latest/meta-data/",
      "/to-mapped-loopback": `http://[::ffff:127.0.0.2]:${port}/final`,
      "/to-decimal": `http://2130706434:${port}/final`, // 127.0.0.2
      "/to-private": "http://10.0.0.5/admin",
      "/to-file": "file:///etc/passwd",
      "/to-final": "/final",
      "/hop1": "/hop2",
      "/hop2": "/final",
    }
    if (redirects[req.url!]) {
      res.writeHead(302, { Location: redirects[req.url!] })
      res.end()
      return
    }
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end("<html><body>final page</body></html>")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const testAgent = createSafeAgent((ip) => ip !== "127.0.0.1" && isBlockedAddress(ip))

  // safeFetch's up-front URL check would refuse 127.0.0.1, so call undici
  // with the test agent directly: redirect hops only go through the agent's
  // connect-time check, which is what this exercises.
  async function viaTestAgent(path: string) {
    try {
      const res = await undiciFetch(`${base}${path}`, { dispatcher: testAgent, signal: AbortSignal.timeout(5000) })
      return { res }
    } catch (err) {
      const cause = err instanceof Error ? err.cause : undefined
      return { err: cause ?? err }
    }
  }

  const ok = await viaTestAgent("/to-final")
  check("redirect between allowed pages is followed", ok.res?.status === 200, ok)
  check("response.url is the final URL", ok.res?.url === `${base}/final`, ok.res?.url)
  check("response.redirected is set", ok.res?.redirected === true, ok.res?.redirected)
  const twoHops = await viaTestAgent("/hop1")
  check("two allowed hops followed", twoHops.res?.url === `${base}/final`, twoHops.res?.url)

  for (const path of ["/to-metadata", "/to-mapped-loopback", "/to-decimal", "/to-private"]) {
    const r = await viaTestAgent(path)
    check(`redirect ${path} blocked`, isBlockedError(r.err), r.err ?? r.res?.status)
  }
  const fileHop = await viaTestAgent("/to-file")
  check("redirect to file: not followed", !!fileHop.err, fileHop.res?.status)

  // With the real agent the local server itself counts as private
  const direct = await fetchError(`${base}/final`)
  check("local server blocked by default", isBlockedError(direct), direct)

  process.env.MAILFEED_ALLOW_PRIVATE_FETCH = "true"
  const escaped = await fetchError(`${base}/to-final`)
  check("MAILFEED_ALLOW_PRIVATE_FETCH=true allows it", typeof escaped === "string" && escaped.includes("HTTP 200"), escaped)
  delete process.env.MAILFEED_ALLOW_PRIVATE_FETCH

  console.log("Callers")
  const parsed = await fetchAndParseContent(`${base}/final`)
  check("fetchAndParseContent fails with the block message", !!parsed.error?.startsWith(BLOCKED_FETCH_ERROR), parsed)
  check("no page content returned", parsed.rawHtml === undefined, parsed.rawHtml)
  const kind = classifyFetchError(parsed.error)
  check("classified as private_address", kind === "private_address", kind)
  check("not retried by the worker", !isRetryableFetchError(parsed.error))
  const chained = await fetchWithFallbackChain(`${base}/final`, ["direct", "wayback"])
  check("fallback chain stops at the blocked address", chained.attempts.length === 1, chained.attempts)
  check("chain reports the block", !!chained.error?.startsWith(BLOCKED_FETCH_ERROR), chained.error)

  server.close()
  await testAgent.close()

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECKS FAILED`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
