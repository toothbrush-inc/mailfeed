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

Interactive `POST /api/sync` still fire-and-forgets per-link AI. The worker passes `triggerAi: false` and batches AI afterward.

- Gmail/fetch cannot use Gemini Batch (live HTTP).
- Analysis and embeddings: **≤15 items** use the live APIs; more go to Gemini Batch **per user** (never mixed mailboxes). Apply always filters by the `GeminiBatch.userId` row.
- If the email query changed (`syncQuery` mismatch), the worker skips that user until they re-sync in the app.
- `invalid_grant` is recorded on `lastScheduledSyncError` and does not stop other users.

`npm run worker` (loop) or `npm run worker:once` (single tick) for local runs.

### Date-Based Incremental Sync

Gmail's `after:` and `before:` operators use day granularity (YYYY/MM/DD). To handle boundary overlap, `check-new` subtracts 1 day from `syncNewestEmailDate` for the `after:` filter, and `load-more` adds 1 day to `syncOldestEmailDate` for the `before:` filter. Existing `gmailId` deduplication is per user (`userId` + `gmailId`).

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

When every fetcher in the chain fails, `fetchWithFallbackChain()` returns the first fetcher's view of the page (`finalUrl`, `wasRedirected`, `rawHtml`, `isPaywalled`, `paywallType`) with the last fetcher's error. A fetcher sets `insufficientContent` when the page loaded but Readability found almost no text: the direct fetcher's `isPoorContent()` check (under 50 words, X/Twitter exempt), or "Could not parse article content". If no real paywall was detected, the chain then reports `isPaywalled: true` with `paywallType: "insufficient_content"`. The Digest shows these under Paywalled as "Not enough content". Migration `0007` moves existing `FAILED` links with those errors.

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
                    │ - tags[] (link type)          │
                    │ - contentTags[] (category)    │
                    │ - metadataTags[] (access)     │
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
                    │ - analyzedAt = now            │
                    │ - analysisError cleared,      │
                    │   analysisAttempts = 0        │
                    └───────────────────────────────┘
```

The word check runs on every path: `analyzeLink()` (auto, live, bulk), Gemini Batch submit, `POST /api/links/[id]/analyze` (returns 422 `INSUFFICIENT_CONTENT`) and the Wayback route. It mostly catches X/oEmbed posts, which skip the fetch-time 50-word check, and short sign-in/join pages. `scripts/reclassify-thin-content.ts` (dry run by default, `--apply` to write) applies it to links fetched or analyzed before the check existed.

A "Not enough content" post whose nested link was analyzed (e.g. a tweet sharing an open article) counts as analyzed: `ANALYZED_WHERE` in `lib/link-buckets.ts`, used by the Digest and the feed's Analyzed filter. The Digest shows the shared article's summary on the post's row.

Refetch, Wayback, promote-attempt and X-article resolution write new content, so they also clear `analysisError` and reset `analysisAttempts` to 0.

worthinessScore, uniquenessScore and isHighlighted are still in the schema, but the current analysis does not fill them in.

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
│                      └─► Score worthiness & uniqueness                     │
│                           └─► Determine highlight status                   │
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
| Wayback fetcher | `lib/fetchers/wayback.ts`, `lib/wayback-fetcher.ts` | `fetchFromWayback()` |
| AI HTML fallback | `lib/ai-html-parser.ts` | `parseHtmlWithAI()` |
| Nested links | `lib/process-nested-links.ts` | `processNestedLinks()` |
| AI analysis | `lib/analysis.ts`, `lib/gemini-batch.ts` | `analyzeLink()`, `recordAnalysisFailure()`, per-user Gemini Batch apply |
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

*Last updated: February 2026*
