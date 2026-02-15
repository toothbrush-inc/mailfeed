# MailFeed Processing Workflow - Decision Tree

> **IMPORTANT**: This document must be updated whenever changes are made to the sync workflow logic in the files listed in the [Key Files Reference](#key-files-reference) section.

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EMAIL SYNC WORKFLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

[Gmail API] ──► Fetch emails matching user query (default: from:me to:me)
                        │
                        ▼
              ┌─────────────────┐
              │ For each email  │
              └────────┬────────┘
                       │
         ┌─────────────┴─────────────┐
         │  Already processed?       │
         │  (check gmailId in DB)    │
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
                          │    ┌──────────────────────┐
                          │    │ Update link:         │
                          │    │ - FAILED or          │
                          │    │ - PAYWALL_DETECTED   │
                          │    └──────────────────────┘
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
                    ┌───────────────────────┐
                    │ Has textContent AND   │
                    │ has title?            │
                    └───────────┬───────────┘
                                │
                          YES ◄─┴─► NO
                           │        │
                           │    [Skip AI analysis,
                           │     status stays FETCHED]
                           ▼
                    ┌───────────────────────┐
                    │ Update: ANALYZING     │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ analyzeContent()      │
                    │ (Gemini API)          │
                    └───────────┬───────────┘
                                │
                          OK ◄──┴──► ERROR
                           │          │
                           │          ▼
                           │    ┌───────────────────┐
                           │    │ Revert to FETCHED │
                           │    │ Log error         │
                           │    └───────────────────┘
                           ▼
                    ┌───────────────────────────────┐
                    │ AI Output:                    │
                    │ - summary                     │
                    │ - keyPoints[]                 │
                    │ - category                    │
                    │ - tags[]                      │
                    │ - worthinessScore (0-1)       │
                    │ - uniquenessScore (0-1)       │
                    │ - isHighlighted (bool)        │
                    │ - highlightReason             │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ Upsert Category               │
                    └───────────────┬───────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │ Update link: COMPLETED        │
                    │ - Store all AI fields         │
                    │ - Link to category            │
                    │ - Set analyzedAt timestamp    │
                    └───────────────────────────────┘
```

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
                    │  FAILED  │     │ (stays FETCHED on         │
                    └──────────┘     │  AI analysis failure)     │
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
│  GMAIL API                                                                  │
│  └─► Emails matching user query (configurable, default: from:me to:me)     │
│       └─► Filter already processed                                          │
│            └─► Batch fetch email contents (configurable concurrency)        │
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
| Sync | `app/api/sync/route.ts` | Fire-and-forget (`recordFetchAttempts(...).catch(...)`) to not slow batch processing |
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
| Sync orchestration | `app/api/sync/route.ts` | `POST()`, `processLink()`, `processLinksInParallel()` |
| User settings | `lib/settings.ts`, `lib/user-settings.ts` | `resolveSettings()`, `getUserSettings()` |
| AI provider config | `lib/ai-provider.ts`, `lib/baml-registry.ts` | `isAiConfigured()`, `buildClientRegistry()` |
| Gmail integration | `lib/gmail.ts` | `fetchEmails()`, `batchGetEmailContents()` |
| Link extraction | `lib/link-extractor.ts` | `extractLinks()`, `hashUrl()`, `extractDomain()` |
| Fallback chain | `lib/fetchers/index.ts` | `fetchWithFallbackChain()` |
| Direct fetcher | `lib/fetchers/direct.ts`, `lib/content-fetcher.ts` | `fetchAndParseContent()`, `isPoorContent()` |
| Wayback fetcher | `lib/fetchers/wayback.ts`, `lib/wayback-fetcher.ts` | `fetchFromWayback()` |
| AI HTML fallback | `lib/ai-html-parser.ts` | `parseHtmlWithAI()` |
| Nested links | `lib/process-nested-links.ts` | `processNestedLinks()` |
| AI analysis | `lib/gemini.ts` | `analyzeContent()` |
| Fetch attempt recording | `lib/fetch-attempts.ts` | `recordFetchAttempts()`, `recordSingleFetchAttempt()` |
| Fetch attempts API | `app/api/links/[id]/attempts/route.ts` | List attempts (no rawHtml) |
| Fetch attempt detail API | `app/api/links/[id]/attempts/[attemptId]/route.ts` | Single attempt (with rawHtml) |

---

## Cleanup Tasks (Planned)

### High Priority
1. **Unify Link Processing** - Merge `processLink()` and `processNestedLinks()` into single `lib/link-processor.ts`
2. **Extract URL Validation** - Create `lib/link-utils.ts` with `shouldExcludeUrl()`, `checkDuplicateByFinalUrl()`

### Medium Priority
3. **Break Down processLink** - Split 250-line function into focused helpers
4. **Strategy Pattern for Content Fetcher** - (Optional) Separate oEmbed, Readability, metadata strategies

### Quick Wins
5. **Centralize Domain Constants** - Create `lib/constants/domains.ts`
6. **Standardize Error Logging** - Create `lib/logger.ts` with `syncLogger`
7. **Extract Status Transitions** - Create `lib/link-status.ts`

See full details in project plan file.

---

*Last updated: February 2026*
