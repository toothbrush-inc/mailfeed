# MailFeed Processing Workflow - Decision Tree

> **IMPORTANT**: This document must be updated whenever changes are made to the sync workflow logic in the files listed in the [Key Files Reference](#key-files-reference) section.

## High-Level Flow — Mode-Based Sync

The sync system uses four modes, driven by date-based Gmail search operators (`after:`, `before:`) for incremental sync. No persistent page tokens are stored — pagination within a single request uses Gmail's `nextPageToken` ephemerally.

### Sync Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| `check-new` | Sync button, **hourly worker** | Appends `after:` to query using `syncNewestEmailDate`; the watermark only advances when a run reaches the end |
| `load-more` | "Load Older" button | Appends `before:` to query using `syncOldestEmailDate` |
| `initial` | First sync (app or worker) or after query change | No date filter, fetches from beginning |
| `full-resync` | Overflow menu | Same as `initial` (clears state, doesn't delete data) |

### User Model — Sync Fields

```
User
├── lastSyncAt               DateTime?   (when sync last completed)
├── syncQuery                String?     (email query active when sync state was captured)
├── syncNewestEmailDate      DateTime?   (receivedAt of most recent synced email)
├── syncOldestEmailDate      DateTime?   (receivedAt of oldest synced email)
├── scheduledSyncStartedAt   DateTime?   (hourly worker lock)
├── lastScheduledSyncAt      DateTime?
└── lastScheduledSyncError   String?
```

### Scheduled (hourly) sync

The Docker `worker` service runs `scripts/worker.ts` with no browser session. It uses stored Gmail refresh tokens via `getGmailClient(userId)`:

1. Every ~2 minutes, **reap** in-flight Gemini Batch jobs and write results with `{id, userId}`. Up to 50 per tick, oldest first. Finished jobs are always applied, however late. A batch that 72h after submit is still running (then cancelled), still cannot be looked up, or has no Gemini key to look it up with, is marked `EXPIRED` and its items go back to `FETCHED` (analysis) or embedding `FAILED` so the next sync resubmits them. Before 72h a missing key or failed lookup just retries next tick.
2. Every hour, for each user with a Google refresh token and `settings.sync.scheduled` (default true): **check-new** (or **initial** if they have never synced), fetch new links, then submit analysis/embeddings.
   Before submitting, it recovers links left behind by a crash or restart (not updated for 24h):
   - `PENDING`/`FETCHING` top-level links are fetched again, up to 50 per run. Each gets **one** retry: `fetchError` is set to a marker first, and a marked link found stuck again is set to `FAILED` ("Fetch was interrupted"). Nested links are set to `FAILED` without a retry. Hidden-domain links, which are parked in `PENDING`, are skipped.
   - `ANALYZING` links not in an in-flight Gemini batch go back to `FETCHED` through `recordAnalysisFailure`, which counts as an attempt, so `MAX_AUTO_ANALYSIS_ATTEMPTS` (3) still applies.
   - Top-level `FAILED` links whose last failure was **temporary** (timeout, 5xx, network error, or 429 rate limit; `RETRYABLE_FAILURES` in `lib/link-buckets.ts`) get up to 3 more fetches, 1h, 6h and 24h after the previous one. Retries are counted on the link (`fetchRetryCount`, `lastFetchRetryAt`) before each fetch, so a retry that crashes or records no `FetchAttempt` still counts. Dead domains (ENOTFOUND) and certificate errors, hidden links (`domain` or `finalDomain`), and links given up on after an interrupted fetch are not retried. The worker only looks at failures from the last 3 days, oldest first. `scripts/retry-unfetched-links.ts` is a one-off backfill without that window or the per-run caps; it takes each user's scheduled-sync lock and skips users the worker is syncing.
   - Other finished links (`FAILED` as blocked/404/unreadable, `PAYWALL_DETECTED`, `FETCHED`, `COMPLETED`) are never fetched again by the worker.

Interactive `POST /api/sync` still fire-and-forgets per-link AI. The worker passes `triggerAi: false` and batches AI afterward.

- Gmail/fetch cannot use Gemini Batch (live HTTP).
- Analysis and embeddings: **≤15 items** use the live APIs; more go to Gemini Batch **per user** (never mixed mailboxes). Apply always filters by the `GeminiBatch.userId` row.
- If the email query changed (`syncQuery` mismatch), the worker skips that user until they re-sync in the app.
- `invalid_grant` is recorded on `lastScheduledSyncError` and does not stop other users.

`npm run worker` (loop) or `npm run worker:once` (single tick) for local runs.

### Date-Based Incremental Sync

Gmail's `after:` and `before:` operators use day granularity (YYYY/MM/DD). To handle boundary overlap, `check-new` subtracts 1 day from `syncNewestEmailDate` for the `after:` filter, and `load-more` adds 1 day to `syncOldestEmailDate` for the `before:` filter. Existing `gmailId` deduplication is per user (`userId` + `gmailId`). After a successful fetch, a link is dropped as a duplicate only if another link with the same final URL already has content (`FETCHED`, `ANALYZING` or `COMPLETED`); a failed or in-progress duplicate never causes a delete.

**Page cap and backlog.** Only pages with at least one new message count against the page cap; pages of already-synced mail are listed and skipped. Gmail lists newest first, so a `check-new` that stops at its cap has stored the newest mail but not older unseen mail. It therefore leaves `syncNewestEmailDate` unchanged (`updateSyncCoverage(userId, { advanceNewest: false })`). The next run searches from the same date, skips the pages it already stored, and continues into the backlog. `load-more` never advances `syncNewestEmailDate`, so it cannot skip a held-back backlog either.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    MODE-BASED SYNC DISPATCH                                  │
└─────────────────────────────────────────────────────────────────────────────┘

POST /api/sync?mode=<mode>
        │
        ▼
┌──────────────────┐
│ Parse mode param │
│ (default:        │
│  check-new)      │
└────────┬─────────┘
         │
         ├── check-new ──────► Query mismatch? ──YES──► Return { queryChanged: true }
         │                          │ NO
         │                          ▼
         │                     syncNewestEmailDate null? ──YES──► Fall through to initial
         │                          │ NO
         │                          ▼
         │                     Build: query + after:(newestDate - 1 day)
         │                     Fetch 1 page with new mail (synced pages skipped)
         │                     If no new emails and not cut off → { upToDate: true }
         │                     Cut off? → keep syncNewestEmailDate (resume next run)
         │
         ├── load-more ──────► syncOldestEmailDate null? ──YES──► Error
         │                          │ NO
         │                          ▼
         │                     Build: query + before:(oldestDate + 1 day)
         │                     Fetch up to maxPagesLoadMore pages
         │
         ├── initial ────────► Clear sync state (syncQuery, dates)
         │                     Fetch plain query, up to maxPagesInitial pages
         │                     Set syncQuery = current query
         │
         └── full-resync ───► Same as initial
```

## Email Processing Flow

```
[Gmail API] ──► Fetch emails matching augmented query
                        │
                        ▼
              ┌─────────────────┐
              │ For each email  │
              └────────┬────────┘
                       │
         ┌─────────────┴─────────────┐
         │  Already processed?       │
         │  (gmailId for this user)  │
         └─────────────┬─────────────┘
                 YES ◄─┴─► NO
                  │        │
              [Skip]       ▼
                     ┌───────────────┐
                     │ Save email    │
                     │ to database   │
                     └───────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Extract links  │
                    │ from content   │
                    └───────┬────────┘
                            │
                            ▼
                 ┌──────────────────────┐
                 │ For each extracted   │
                 │ link URL             │
                 └──────────┬───────────┘
                            │
                            ▼
                            │
         ══════════════════════════════════════════
                    LINK PROCESSING
         ══════════════════════════════════════════
```

## Link Processing Decision Tree

```
                        ┌─────────────────┐
                        │   Start Link    │
                        │   Processing    │
                        └────────┬────────┘
                                 │
                                 ▼
                    ┌────────────────────────┐
                    │ Duplicate check        │
                    │ (urlHash in DB?)       │
                    └───────────┬────────────┘
                          YES ◄─┴─► NO
                           │        │
                       [Skip]       ▼
                              ┌─────────────────┐
                              │ Create link     │
                              │ status: PENDING │
                              └────────┬────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │ Update status:  │
                              │ FETCHING        │
                              └────────┬────────┘
                                       │
                                       ▼
                    ┌──────────────────────────────┐
                    │  fetchWithFallbackChain()   │
                    │  (Fallback Chain Fetcher)   │
                    │  chain: [direct, wayback]   │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
```

## Content Fetching Decision Tree

```
                    ┌──────────────────────────────┐
                    │   fetchAndParseContent()     │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │ Is social media domain?      │
                    │ (twitter, instagram, etc.)   │
                    └──────────────┬───────────────┘
                             YES ◄─┴─► NO
                              │        │
                              ▼        │
                    ┌────────────────┐ │
                    │ Try oEmbed API │ │
                    └───────┬────────┘ │
                      OK ◄──┴──► FAIL  │
                       │         │     │
              [Return  │         └──┬──┘
              oEmbed]  │            │
                       ▼            ▼
                    ┌──────────────────────────────┐
                    │ HTTP Fetch with headers      │
                    │ (User-Agent spoofing)        │
                    │ Follow redirects             │
                    │ safeFetch: private addresses │
                    │ refused on every hop         │
                    └──────────────┬───────────────┘
                                   │
                         SUCCESS ◄─┴─► FAILURE
                            │           │
                            ▼           ▼
                    ┌───────────┐  ┌──────────────┐
                    │ Parse     │  │ Return error │
                    │ HTML      │  │ with rawHtml │
                    └─────┬─────┘  └──────────────┘
                          │
                          ▼
                    ┌──────────────────────────────┐
                    │ Readability.js parse         │
                    └──────────────┬───────────────┘
                                   │
                         SUCCESS ◄─┴─► FAILURE
                            │           │
                            │           ▼
                            │    ┌──────────────────┐
                            │    │ Extract metadata │
                            │    │ (OG, news site)  │
                            │    └────────┬─────────┘
                            │             │
                            └──────┬──────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │ Detect paywall               │
                    │ - Hard paywall               │
                    │ - Soft paywall               │
                    │ - Registration wall          │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                         [Return ParseResult]
```

### Private-network block

Every server-side fetch of a URL from a user or an email goes through `safeFetch()` in `lib/safe-fetch.ts`: the direct fetch, oEmbed, Wayback (API and snapshot), t.co/short-link resolution in `lib/nested-link-extractor.ts`, and X article resolution. It only allows `http:`/`https:` and refuses loopback, private (10/8, 172.16/12, 192.168/16), link-local (169.254/16 incl. cloud metadata, fe80::/10), CGNAT (100.64/10), 0.0.0.0/8, unique-local (fc00::/7), multicast, broadcast/reserved and documentation ranges, and IPv6 forms that embed those IPv4 addresses (`::ffff:127.0.0.1`, NAT64, 6to4).

The check runs in an undici `Agent` when each connection is opened, so it covers every redirect hop (redirects are still followed and `response.url` is the final URL, so `finalUrl`/`wasRedirected` are unchanged). IP-literal hosts are checked directly; hostnames are checked in the connection's DNS lookup, on the addresses the socket actually connects to, so DNS rebinding can't slip past. A name with any blocked address is refused.

A refused fetch fails with `Blocked: address is on a private network (...)` and no page content. `fetchWithFallbackChain()` stops there instead of asking the next fetcher (Wayback). The Digest labels it "Points to a private network address" (`private_address` in `classifyFetchError()`), and the worker does not retry it. `POST /api/links/add` rejects such URLs up front with a 400.

`MAILFEED_ALLOW_PRIVATE_FETCH=true` turns the block off, for local development and tests only.

## Post-Fetch Processing Decision Tree

```
                    ┌──────────────────────────────┐
                    │ After fetchAndParseContent() │
                    │ returns ParseResult          │
                    └──────────────┬───────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │ isPoorContent()?             │
                    │ (< 100 words, no title, etc) │
                    └──────────────┬───────────────┘
                                   │
                            YES ◄──┴──► NO
                             │          │
                             ▼          │
        ┌────────────────────────────┐  │
        │ AI FALLBACK PATH           │  │
        │ parseHtmlWithAI()          │  │
        │ - Uses BAML/Gemini         │  │
        │ - Extracts from raw HTML   │  │
        └─────────────┬──────────────┘  │
                      │                 │
               OK ◄───┴───► FAIL        │
                │            │          │
                │            └────┬─────┘
                │                 │
                ▼                 ▼
        ┌───────────────────────────────────────────┐
        │ Check if final URL is excluded domain     │
        │ (google.com, bit.ly, etc.)                │
        └───────────────────┬───────────────────────┘
                            │
                      YES ◄─┴─► NO
                       │        │
                       ▼        │
              ┌─────────────┐   │
              │ DELETE link │   │
              │ from DB     │   │
              └─────────────┘   │
                                ▼
        ┌───────────────────────────────────────────┐
        │ Check duplicate by final URL              │
        │ (after redirects resolved)                │
        └───────────────────┬───────────────────────┘
                            │
                      YES ◄─┴─► NO
                       │        │
                       ▼        │
              ┌─────────────┐   │
              │ DELETE link │   │
              │ (duplicate) │   │
              └─────────────┘   │
                                ▼
                    ┌───────────────────────┐
                    │ content.success?      │
                    └───────────┬───────────┘
                                │
                         YES ◄──┴──► NO
                          │          │
                          │          ▼
                          │    ┌──────────────────────────────┐
                          │    │ Update link:                 │
                          │    │ - PAYWALL_DETECTED if a      │
                          │    │   paywall was detected, or   │
                          │    │   the page had too little    │
                          │    │   text (paywallType          │
                          │    │   "insufficient_content")    │
                          │    │ - otherwise FAILED           │
                          │    └──────────────────────────────┘
                          │
                          ▼
                    ┌───────────────────────┐
                    │ Update link: FETCHED  │
                    │ - title, description  │
                    │ - imageUrl            │
                    │ - contentText         │
                    │ - wordCount           │
                    │ - readingTimeMin      │
                    └───────────┬───────────┘
                                │
                                ▼
```

When every fetcher in the chain fails, `fetchWithFallbackChain()` returns the first fetcher's view of the page (`finalUrl`, `wasRedirected`, `rawHtml`, `isPaywalled`, `paywallType`) with the last fetcher's error. A fetcher sets `insufficientContent` when the page loaded but Readability found almost no text: the direct fetcher's `isPoorContent()` check (under 50 words; X/Twitter and video pages are exempt, see [Media links](#media-links)), or "Could not parse article content". If no real paywall was detected, the chain then reports `isPaywalled: true` with `paywallType: "insufficient_content"`. The Digest shows these under Paywalled as "Not enough content". Migration `0007` moves existing `FAILED` links with those errors.

## Post-Sync Coverage Update

After every sync (all modes), `updateSyncCoverage()` queries the Email table for min/max `receivedAt` and updates `syncNewestEmailDate` and `syncOldestEmailDate` on the User.

## Query Change Detection

When the email query is changed in settings:
1. `PATCH /api/settings` detects the change
2. Clears `syncQuery`, `syncNewestEmailDate`, `syncOldestEmailDate` on User
3. Returns `{ queryChanged: true }` to the client
4. SyncButton UI shows an amber warning and changes the primary action to "Resync"
5. Clicking "Resync" triggers `initial` mode sync with the new query

## Nested Links Processing (Social Media)

```
                    ┌───────────────────────┐
                    │ processNestedLinks()  │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │ Is social media domain?       │
                    │ (twitter, x.com, instagram,   │
                    │  tiktok, threads, facebook)   │
                    └───────────────┬───────────────┘
                                    │
                              YES ◄─┴─► NO
                               │        │
                               │    [Return: no nested links]
                               ▼
                    ┌───────────────────────────────┐
                    │ Extract URLs from raw HTML    │
                    │ (t.co, links in text, etc.)   │
                    │ Skips other posts/profiles on │
                    │ social platforms; keeps media │
                    │ links (YouTube video, TikTok) │
                    │ X posts: + links of the post  │
                    │ it quotes (QUOTED_POST)       │
                    └───────────────┬───────────────┘
                                    │
                        [For each nested URL]
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ Create child link record      │
                    │ (parentLinkId = parent.id)    │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ Fetch & process child link    │
                    │ (same flow as parent)         │
                    └───────────────────────────────┘
```

Which links in a post are kept is decided by `isSkippedNestedUrl()` in `lib/nested-link-extractor.ts`. Links to other social posts and profiles are skipped (a quoted tweet, a YouTube channel), unless `classifyMediaUrl()` recognizes the link as a media item: a YouTube video, a TikTok, a reel. The same exception applies to the final-URL check in `createNestedLink()`.

For a post on X, `processNestedLinks()` also reads the post's context (`lib/post-context.ts`, stored in `Link.postContext`): the video uploaded to it, and the post it quotes with that post's links and video. This comes from the endpoint embedded posts are rendered from, which needs no key but is not a documented API. When it fails, the post is handled from oEmbed alone, as before. The quoted post's links go through the same rules as the post's own and become nested links with `foundVia = QUOTED_POST`. One nested link is created and fetched by `createNestedLink()` in `lib/nested-link.ts`.

A shortened link (t.co, bit.ly) is resolved in two steps. The shortener's own redirect is read first: if it points at a media item, that address is kept as is, because following it further can end on a consent or bot-check page. Otherwise the redirects are followed to the end as before. Each shortened link is resolved once per post.

## Media links

`lib/media.ts` decides which links are a video, a podcast, a book or a game. Nothing is stored: the type is derived when the Media page is loaded, so a rule change needs no backfill.

1. **URL rules** (`classifyMediaUrl()`): a table of hosts and paths (YouTube watch pages, Spotify episodes, Goodreads books, Steam apps, and so on), Amazon products that are books (ISBN-10 ASIN, an "ebook" slug, or a title that says so), video files, and `/podcast/` sections. The final URL is checked before the original, so short links are judged by their destination.
2. **AI link tags** (`classifyMedia()`), only when no URL rule matches: `PODCAST`, `BOOK`, `GAME`, `VIDEO` without `ARTICLE`, and `AUDIO` on pages that read as a podcast (analyses older than the `PODCAST` tag).

Video pages skip the direct fetcher's poor-content check. YouTube's oEmbed response is a player with no text, so the check used to fail the link, drop its title and thumbnail, and send it to Wayback. It is now saved as `FETCHED` with its title, thumbnail and "By {channel} on YouTube" as the description. Analysis then marks it "Not enough content" as for any link under 25 words, which does not affect the Media page.

`GET /api/media` (`lib/media-list.ts`) narrows the user's links in SQL to those a rule could match, classifies them, lists the same item once (same YouTube id, same Amazon ASIN, or same URL without tracking parameters), and leaves out hidden domains. Nested links are included and point back to the post they were found in.

A post with an uploaded video is one entry, whatever is known about it: the post itself ("Video on X") while its source is unknown, or the recording the media lookup found, with the matching short clip attached to the same entry. Podcast episodes and books it found are entries of their own. A post is not listed as itself when one of its links already is the video.

`POST /api/media/rescan` (`lib/media-rescan.ts`, the "Scan saved posts" button) catches up links synced before these rules, using only what is stored:

1. `processNestedLinks()` runs again on every social media post. Links that already exist are skipped, so only links that used to be dropped are created. Posts on X get their context stored and are queued for the media lookup where it applies. The scan makes no AI calls.
2. Videos saved without a title get their title, thumbnail and description from oEmbed.

Each call works for about 20 seconds and returns a cursor; the page repeats the call until `done`.

## Media Lookup (what a post or page points at without linking it)

A post often shows a clip uploaded to X, or quotes a post that does, with no link to where the clip comes from. It may name a podcast episode or a book. An article may recommend books. A podcast episode's show notes link what the episode discusses. `lib/media-lookup.ts` finds the public video, the podcast episode, the books and the show-notes links, and adds them as nested links.

What queues a link for a lookup (`lookupStatus = PENDING`):

| Link | Rule |
|------|------|
| Post on X | `flagForLookup()` in `processNestedLinks()`: the post or the post it quotes has an uploaded video, or its words suggest a recording ("this talk", "interview", "episode"), and none of its nested links is a video or podcast. Or its words suggest a book ("book", "novel", "finished reading"). |
| Any analyzed link | `flagForBookLookup()` when the analysis names books (`LinkAnalysis.books`, stored in `Link.mentionedBooks`). A page analyzed again is queued again; a post keeps the outcome of its earlier lookup. |
| Podcast link | Any link `classifyMediaUrl()` calls a podcast, wherever it came from: emailed (`processNestedLinks()`), nested in a post (`createNestedLink()`), or an episode the lookup found (`createFoundLink()`). Not a link that itself came out of show notes: one episode's notes are followed, not the episodes they cite. |

```
lookUpMedia(link)  (claims the link: RUNNING)
        │
        ├── Post? ──► 1. Triage: TriagePost (BAML)
        │                  recording: one specific recording published elsewhere?
        │                             (not own footage, memes, demos)
        │                             description, onVideo, searchQueries, podcast terms
        │                  books: specific books the post names
        │
        ├── Recording, and the post doesn't already link one
        │       ├── video ──► Gemini + Google Search tool
        │       │             candidates = video URLs in the answer, the search
        │       │             results, and links or players on the result pages,
        │       │             each confirmed with oEmbed (YouTube, Vimeo, TikTok)
        │       ├── podcast ► Apple's podcast directory (lib/catalogs.ts)
        │       │
        │       └── 2. Pick: PickSources (BAML), by index among the candidates:
        │              the same clip (CLIP), the complete recording (FULL),
        │              the podcast episode (EPISODE)
        │
        ├── Podcast episode? ──► show notes (lib/show-notes.ts)
        │       Apple's directory gives the show's RSS feed and the episode's
        │       guid (an Apple address carries the ids; any other podcast page
        │       is matched by its exact title). The episode's <item> in the
        │       feed has the notes as HTML, with their links.
        │       └── PickShowNoteLinks (BAML), by index among the links: the
        │           ones the episode discusses, cites or recommends. Not
        │           sponsors, the show's own subscribe and support links,
        │           social profiles, or the same episode elsewhere. Also
        │           returns books the notes name without linking.
        │           Kept links (at most 20) ──► nested under the episode,
        │           foundVia = SHOW_NOTES
        │
        └── Books (from triage, mentionedBooks and show notes, at most 8)
                └── Open Library (lib/catalogs.ts), no AI: the title must match
                    and, when an author is named, the author too; without an
                    author only a title with several editions is trusted (BOOK)

   Each find ──► nested link, foundVia = AI_LOOKUP, foundRole = FULL | CLIP | EPISODE | BOOK
   Something found ──► FOUND          Something to find, no match ──► NOT_FOUND
   Nothing to find ──► SKIPPED        A source unreachable or an error ──► FAILED
```

The model names things and chooses among candidates; it never supplies a link. Videos are fetched like any nested link (`createNestedLink()`); episodes and books are created from the catalog's own details without fetching their pages (`createFoundLink()`).

An episode the lookup finds for a post has its own show notes read straight away, so a post about an episode can end up three levels deep: post → episode → what its notes link. Show-notes links go through the same rules as links in a post (`resolveNestedUrl()`: short links followed, including `amzn.to` and other store and player shorteners; social profiles left out). A video among them gets its title and thumbnail from oEmbed. Every other link is kept as a reference, under the name the notes give it and without fetching the page (`contentSource = "show_notes"`). The feed shows them under an emailed episode like any nested links, and as a compact list under an episode that is itself nested.

A find can be wrong, so found links are labelled in the feed and on the Media page. "Wrong video", "Wrong episode" and "Wrong book" (`DELETE /api/links/[id]/found`) remove the found link and record it in the parent's `lookupRejected`, so no later lookup brings it back. A video's full recording and clip go together. When nothing found is left the parent is `REJECTED` and is not looked up again on its own.

When lookups run:

| Where | How |
|-------|-----|
| Interactive sync | After `runSyncForUser()`, up to 10 waiting links, two at a time, without holding up the response |
| Scheduled worker | After the AI batch is submitted, up to 20 per run (video search needs a live search and can't be batched) |
| Adding or refetching one link, analyzing one link | Started for that link straight away (`triggerMediaLookup()`) |
| Bulk analysis (Settings) | After the batch, up to 20 waiting links |
| Media page | "Find sources" works through every waiting link (`POST /api/media/lookups`, two per call); "Find source" / "Look again" on a row runs one post again (`POST /api/links/[id]/lookup`) |

A lookup needs `NEXT_PUBLIC_ENABLE_ANALYSIS`, `analysis.enabled`, `analysis.mediaLookup` (Settings → Content Analysis → "Find sources", on by default), a key for the selected analysis model (triage and pick) and a Gemini key (the video search always runs on Gemini). A lookup left `RUNNING` for 10 minutes was interrupted and can be claimed again.

Cost: triage and pick are short calls, and most posts stop at triage. The video search is one grounded request, billed for its tokens plus a fee for each Google search it runs. The prompt asks for one or two searches and tells the model not to search for links, which the result pages already provide; asked for exact URLs it ran up to six. Podcast and book lookups use free catalogs and no search. Reading an episode's show notes is one short AI call. All AI calls are recorded as `MEDIA_LOOKUP` in `AiUsage`, the search call with its search count and fee (see AI usage recording).

Limits: only posts on X have the context a recording lookup needs. The catalogs are literal: a book filed under its original-language title, or an episode the directory doesn't list, is not found. Show notes come from the show's public feed: a show without one in Apple's directory, or an episode no longer in its feed, has none. An episode older than the 200 the directory lists is looked for in the feed by its title.

## AI Analysis Decision Tree

```
                    ┌───────────────────────────────┐
                    │ Picked up for analysis?       │
                    │ FETCHED, analyzedAt null,     │
                    │ has rawHtml or contentText,   │
                    │ analysisAttempts < 3          │
                    └───────────┬───────────────────┘
                                │
                          YES ◄─┴─► NO
                           │        │
                           │    [Skip; status stays FETCHED.
                           │     "Analyze again" on /digest
                           │     still runs it by hand]
                           ▼
                    ┌───────────────────────────────┐
                    │ analyzableWordCount() ≥ 25?   │
                    │ (links, @handles, "via @x",   │
                    │  tweet attribution excluded)  │
                    └───────────┬───────────────────┘
                                │
                          YES ◄─┴─► NO
                           │        │
                           │    markInsufficientContent():
                           │    PAYWALL_DETECTED,
                           │    paywallType "insufficient_content",
                           │    earlier AI fields cleared. No AI call.
                           ▼
                    ┌───────────────────────┐
                    │ Update: ANALYZING     │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────────────┐
                    │ BAML IngestLink               │
                    │ (live analyzeLink(), or a     │
                    │  per-user Gemini Batch)       │
                    └───────────┬───────────────────┘
                                │
                          OK ◄──┴──► ERROR (call, empty or
                           │          │     unparsable response,
                           │          │     whole batch failed)
                           │          ▼
                           │    ┌──────────────────────────────┐
                           │    │ recordAnalysisFailure():     │
                           │    │ - Revert to FETCHED          │
                           │    │ - analysisError = message    │
                           │    │ - analysisAttempts += 1      │
                           │    └──────────────────────────────┘
                           ▼
                    ┌───────────────────────────────┐
                    │ AI Output (LinkAnalysis):     │
                    │ - summary                     │
                    │ - keyPoints[] (3-5)           │
                    │ - tags[] (link type: ARTICLE, │
                    │   VIDEO, PODCAST, BOOK, GAME…)│
                    │ - contentTags[] (category)    │
                    │ - metadataTags[] (access)     │
                    │ - worthReading (1-5)          │
                    │ - worthReason (one sentence)  │
                    │ - books[] (recommended or     │
                    │   discussed; → Media Lookup)  │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ fieldsFromLinkAnalysis():     │
                    │ Update link: COMPLETED        │
                    │ - aiSummary, aiKeyPoints      │
                    │ - aiCategory = contentTags[0] │
                    │ - isPaywalled / paywallType   │
                    │   from metadataTags           │
                    │ - worthinessScore = worth-    │
                    │   Reading clamped to 1-5      │
                    │   (null if missing)           │
                    │ - highlightReason =           │
                    │   worthReason                 │
                    │ - isHighlighted = score == 5  │
                    │ - analyzedAt = now            │
                    │ - analysisError cleared,      │
                    │   analysisAttempts = 0        │
                    └───────────────────────────────┘
```

The word check runs on every path: `analyzeLink()` (auto, live, bulk), Gemini Batch submit, `POST /api/links/[id]/analyze` (returns 422 `INSUFFICIENT_CONTENT`) and the Wayback route. It mostly catches X/oEmbed posts, which skip the fetch-time 50-word check, and short sign-in/join pages. `scripts/reclassify-thin-content.ts` (dry run by default, `--apply` to write) applies it to links fetched or analyzed before the check existed.

A "Not enough content" post whose nested link was analyzed (e.g. a tweet sharing an open article) counts as analyzed: `ANALYZED_WHERE` in `lib/link-buckets.ts`, used by the Digest and the feed's Analyzed filter. The Digest shows the shared article's summary on the post's row.

Refetch, Wayback, promote-attempt and X-article resolution write new content, so they also clear `analysisError` and reset `analysisAttempts` to 0.

The "worth reading" score is `worthFieldsFromAnalysis()` in `lib/analysis.ts`, used by `fieldsFromLinkAnalysis()` (live, bulk, per-link analyze, Gemini Batch) and the Wayback route. Every re-analysis overwrites it. `markInsufficientContent()` and promote-attempt clear it (`worthinessScore` null, `isHighlighted` false, `highlightReason` null). The feed sorts by it with `GET /api/links?sort=worth` (nulls last, then newest). Links analyzed before the score existed stay unscored until re-analyzed. `uniquenessScore` is still in the schema but unused.

### AI usage recording

Every billed AI call writes an `AiUsage` row (`lib/ai-usage.ts`) with the model, input tokens, output tokens (thinking included, since Gemini bills it as output) and the cost at the list price in effect (`lib/ai-pricing.ts`). Live BAML calls (`analyzeLink()`, per-link analyze, Wayback, email ingest) run through `withBamlUsage()`, which attaches a BAML `Collector` and reads Gemini's raw `usageMetadata`, because BAML's own usage leaves out thinking tokens. Each call BAML made is recorded, retries included, whether or not the analysis succeeded. The Gemini Batch reaper records one `batch: true` row per analyze item from that item's `usageMetadata`, at the 50% batch price. Chat records its `generateContent` usage. The media lookup records its BAML calls and its search call as `MEDIA_LOOKUP`.

Search grounding is billed per Google search on top of tokens. A call's `searchRequests` is the number of queries Gemini reports having run (`groundingMetadata.webSearchQueries`), and its `costUsd` includes the fee from `priceSearches()`: nothing until the user's recorded searches for the calendar month (UTC) pass the free allowance, then the per-search price. The allowance belongs to the Google billing account, so searches made outside MailFeed, or by other users of a shared host key, use it up without being counted here. "Your AI Spend" shows the month's search count against the allowance. Embeddings are not recorded. Recording never fails the call it describes. `GET /api/ai-usage` aggregates the rows for "Your AI Spend" in Settings.

## Link Status State Machine

```
                    ┌─────────────────────────────────────────────┐
                    │             LINK STATUS STATES              │
                    └─────────────────────────────────────────────┘

    ┌─────────┐     ┌──────────┐     ┌─────────┐     ┌───────────┐     ┌───────────┐
    │ PENDING │────►│ FETCHING │────►│ FETCHED │────►│ ANALYZING │────►│ COMPLETED │
    └─────────┘     └──────────┘     └─────────┘     └───────────┘     └───────────┘
                          │                │               │
                          │                │               │
                          ▼                ▼               ▼
                    ┌──────────┐     ┌───────────────────────────┐
                    │  FAILED  │     │ back to FETCHED on AI     │
                    └──────────┘     │ failure, with             │
                          │         │ analysisError set         │
                          │         └───────────────────────────┘
                          │
                          ▼
               ┌───────────────────┐
               │ PAYWALL_DETECTED  │
               └───────────────────┘
```

## Summary: Complete Data Flow

```
┌────────────────────────────────────────────────────────────────────────────┐
│  SYNC MODE DISPATCH                                                        │
│  └─► check-new: after: filter from syncNewestEmailDate                    │
│  └─► load-more: before: filter from syncOldestEmailDate                   │
│  └─► initial/full-resync: no date filter, fetches from beginning          │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  GMAIL API                                                                  │
│  └─► Emails matching augmented query (with date operators)                │
│       └─► Filter already processed (gmailId dedup for this userId)        │
│            └─► Batch fetch email contents (configurable concurrency)       │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  LINK EXTRACTION                                                            │
│  └─► Parse HTML for URLs                                                   │
│       └─► Filter excluded domains                                          │
│            └─► Deduplicate by urlHash                                      │
│                 └─► Create link records (status: PENDING)                  │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  CONTENT FETCHING (configurable concurrency, fallback chain)                │
│  └─► fetchWithFallbackChain() tries each fetcher in order:                 │
│       └─► "direct": oEmbed → HTTP fetch → Readability → paywall detect    │
│            └─► "wayback": Wayback Machine archived content                 │
│                 └─► AI fallback if poor content                            │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  POST-PROCESSING                                                            │
│  └─► Check final URL exclusions                                            │
│       └─► Deduplicate by finalUrlHash                                      │
│            └─► Extract nested links (social media)                         │
│                 └─► Process nested links recursively                       │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  SYNC COVERAGE UPDATE                                                       │
│  └─► updateSyncCoverage(): query min/max receivedAt from Email table      │
│       └─► Update syncNewestEmailDate and syncOldestEmailDate on User      │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  AI ANALYSIS (configurable BAML client, default: Gemini)                    │
│  └─► Generate summary                                                       │
│       └─► Extract key points                                               │
│            └─► Categorize content                                          │
│                 └─► Generate tags                                           │
│                      └─► Score "worth reading" 1-5 with a reason           │
│                           └─► Highlight when the score is 5                │
└────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  FINAL STATE: COMPLETED                                                     │
│  Link ready for display in feed with:                                       │
│  - Title, description, image                                               │
│  - Full text content                                                        │
│  - AI summary & key points                                                  │
│  - Category & tags                                                          │
│  - Reading time estimate                                                    │
│  - Highlight status                                                         │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## Settings

### Sync Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `sync.emailConcurrency` | 10 | Emails fetched in parallel from Gmail |
| `sync.linkConcurrency` | 5 | Links fetched in parallel during sync |
| `sync.maxPagesInitial` | 5 | Pages fetched on first sync or full resync |
| `sync.maxPagesLoadMore` | 5 | Pages fetched when loading older history |
| `sync.scheduled` | true | Hourly worker includes this user |
| `sync.maxPagesScheduled` | 5 | Pages the worker may fetch per tick (`check-new` or first `initial`) |

| `analysis.mediaLookup` | true | Look for the video, podcast episode and books a post or page points at without linking them (see Media Lookup) |

Interactive `check-new` fetches 1 page of new mail. The scheduled worker uses `maxPagesScheduled` so a backlog of more than 50 messages can catch up.

---

## Fetch Attempt Tracking

Every content fetch operation records individual `FetchAttempt` entries in the database, providing a complete timeline of which methods were tried, in what order, how long each took, and what errors each produced.

### Data Model

```
FetchAttempt
├── linkId        → Link being fetched
├── operationId   → Groups attempts within one fallback chain run
├── fetcherId     → "direct", "wayback"
├── fetcherName   → Human-readable name
├── trigger       → "sync", "refetch", "wayback_manual"
├── sequence      → 1-indexed position in chain
├── success       → Whether this attempt succeeded
├── error         → Error message if failed
├── rawHtml       → Raw HTML captured from this attempt
├── httpStatus    → HTTP status code (if applicable)
├── durationMs    → How long this attempt took
└── createdAt     → Timestamp
```

### Recording Sites

| Route | File | Strategy |
|-------|------|----------|
| Sync | `lib/sync-user.ts` | Fire-and-forget (`recordFetchAttempts(...).catch(...)`) to not slow batch processing |
| Refetch | `app/api/links/[id]/refetch/route.ts` | `await recordFetchAttempts(...)` since it's a single user-initiated action |
| Wayback manual | `app/api/links/[id]/wayback/route.ts` | `await recordSingleFetchAttempt(...)` with manual timing around `fetchFromWayback()` |

Nested link fetches (`lib/process-nested-links.ts`) are **not** instrumented.

### How It Works

1. `fetchWithFallbackChain()` in `lib/fetchers/index.ts` times each fetcher and returns an `attempts[]` array with `FetchAttemptDetail` records (including `rawHtml` from each fetcher)
2. The calling route passes those details to `recordFetchAttempts()` or `recordSingleFetchAttempt()` in `lib/fetch-attempts.ts`
3. The UI shows fetch history via a dialog triggered from the feed item action buttons
4. List endpoint (`GET /api/links/[id]/attempts`) excludes `rawHtml` for small payloads
5. Detail endpoint (`GET /api/links/[id]/attempts/[attemptId]`) includes `rawHtml` for on-demand viewing

---

## Key Files Reference

| Stage | File | Function |
|-------|------|----------|
| Sync orchestration | `lib/sync-user.ts` | `runSyncForUser()`, Gmail + link fetch (no HTTP session) |
| Sync HTTP | `app/api/sync/route.ts` | Session wrapper around `runSyncForUser` |
| Scheduled worker | `lib/scheduled-sync.ts`, `scripts/worker.ts` | Hourly check-new for all eligible users |
| Gemini Batch | `lib/gemini-batch.ts` | Per-user submit/reap of analysis + embeddings |
| Sync status | `app/api/sync/status/route.ts` | `GET()` — coverage dates, query mismatch detection |
| Sync coverage | `lib/sync-coverage.ts` | `updateSyncCoverage()`, `formatGmailDate()` |
| User settings | `lib/settings.ts`, `lib/user-settings.ts` | `resolveSettings()`, `getUserSettings()` |
| AI provider config | `lib/ai-provider.ts`, `lib/baml-registry.ts` | `isAiConfigured()`, `buildClientRegistry()` |
| Gmail integration | `lib/gmail.ts` | `fetchEmails()`, `batchGetEmailContents()` |
| Link extraction | `lib/link-extractor.ts` | `extractLinks()`, `hashUrl()`, `extractDomain()` |
| Fallback chain | `lib/fetchers/index.ts` | `fetchWithFallbackChain()` |
| Direct fetcher | `lib/fetchers/direct.ts`, `lib/content-fetcher.ts` | `fetchAndParseContent()`, `isPoorContent()` |
| Private-network block | `lib/safe-fetch.ts` | `safeFetch()`, `isBlockedAddress()`, `checkFetchUrlResolved()` |
| Wayback fetcher | `lib/fetchers/wayback.ts`, `lib/wayback-fetcher.ts` | `fetchFromWayback()` |
| AI HTML fallback | `lib/ai-html-parser.ts` | `parseHtmlWithAI()` |
| Nested links | `lib/process-nested-links.ts`, `lib/nested-link.ts`, `lib/nested-link-extractor.ts` | `processNestedLinks()`, `createNestedLink()`, `extractNestedUrls()`, `resolveNestedUrl()`, `isSkippedNestedUrl()` |
| Post context | `lib/post-context.ts` | `fetchPostContext()`, `parsePostContext()`, `mayReferToRecording()` |
| Media lookup | `lib/media-lookup.ts`, `lib/catalogs.ts`, `lib/show-notes.ts`, `baml_src/lookup.baml`, `app/api/links/[id]/lookup/route.ts`, `app/api/links/[id]/found/route.ts`, `app/api/media/lookups/route.ts` | `lookUpMedia()`, `runPendingLookups()`, `rejectFoundLink()`, `searchPodcastEpisodes()`, `findBook()`, `fetchShowNotes()` |
| Media links | `lib/media.ts`, `lib/media-list.ts`, `app/api/media/route.ts` | `classifyMedia()`, `classifyMediaUrl()`, `listMedia()` |
| Media rescan | `lib/media-rescan.ts`, `app/api/media/rescan/route.ts` | `rescanForMedia()`: nested links and video titles for posts synced earlier |
| AI analysis | `lib/analysis.ts`, `lib/gemini-batch.ts` | `analyzeLink()`, `recordAnalysisFailure()`, per-user Gemini Batch apply |
| AI usage & pricing | `lib/ai-usage.ts`, `lib/ai-pricing.ts` | `withBamlUsage()`, `recordAiUsage()`, `priceCall()` |
| Digest groups | `lib/link-buckets.ts`, `app/api/digest/route.ts` | `bucketWhere()`, `classifyFetchError()`: which links were analyzed and why the rest weren't |
| Fetch attempt recording | `lib/fetch-attempts.ts` | `recordFetchAttempts()`, `recordSingleFetchAttempt()` |
| Fetch attempts API | `app/api/links/[id]/attempts/route.ts` | List attempts (no rawHtml) |
| Fetch attempt detail API | `app/api/links/[id]/attempts/[attemptId]/route.ts` | Single attempt (with rawHtml) |
| Client hook | `hooks/use-sync.ts` | `useSync()` — `checkNew()`, `loadMore()`, `initialSync()`, `fullResync()` |
| Sync button | `components/sync/sync-button.tsx` | Mode-based UI with coverage display |
| Sync settings | `components/settings/sync-settings.tsx` | `maxPagesInitial`, `maxPagesLoadMore` |
| Email settings | `components/settings/email-settings.tsx` | Query change with sync reset warning |

---

## Migration Strategy for Existing Users

- `syncPageToken` and `oldestSyncPageToken` columns dropped
- New fields (`syncQuery`, `syncNewestEmailDate`, `syncOldestEmailDate`) default to null
- First "Check New" after migration: `syncNewestEmailDate` is null → treated as `initial` mode
- Subsequent syncs use the fast `after:` path
- Zero-downtime, backward-compatible

---

*Last updated: October 2026*
