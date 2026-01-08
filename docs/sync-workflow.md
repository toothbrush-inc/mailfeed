# MailFeed Processing Workflow - Decision Tree

> **IMPORTANT**: This document must be updated whenever changes are made to the sync workflow logic in the files listed in the [Key Files Reference](#key-files-reference) section.

## High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EMAIL SYNC WORKFLOW                                │
└─────────────────────────────────────────────────────────────────────────────┘

[Gmail API] ──► Fetch self-sent emails (from:me to:me)
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
                    │    fetchAndParseContent()    │
                    │    (Content Fetcher)         │
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
│  └─► Self-sent emails (from:me to:me)                                      │
│       └─► Filter already processed                                          │
│            └─► Batch fetch email contents (10 parallel)                    │
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
│  CONTENT FETCHING (5 parallel)                                              │
│  └─► Try oEmbed (social media)                                             │
│       └─► HTTP fetch with headers                                          │
│            └─► Readability parse OR metadata extraction                    │
│                 └─► Paywall detection                                       │
│                      └─► AI fallback if poor content                       │
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
│  AI ANALYSIS (Gemini)                                                       │
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

## Key Files Reference

| Stage | File | Function |
|-------|------|----------|
| Sync orchestration | `app/api/sync/route.ts` | `POST()`, `processLink()`, `processLinksInParallel()` |
| Gmail integration | `lib/gmail.ts` | `fetchSelfEmails()`, `batchGetEmailContents()` |
| Link extraction | `lib/link-extractor.ts` | `extractLinks()`, `hashUrl()`, `extractDomain()` |
| Content fetching | `lib/content-fetcher.ts` | `fetchAndParseContent()`, `isPoorContent()` |
| AI HTML fallback | `lib/ai-html-parser.ts` | `parseHtmlWithAI()` |
| Nested links | `lib/process-nested-links.ts` | `processNestedLinks()` |
| AI analysis | `lib/gemini.ts` | `analyzeContent()` |

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

*Last updated: January 2025*
