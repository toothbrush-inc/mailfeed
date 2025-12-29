# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MailFeed is a Next.js application that reads self-sent Gmail emails, extracts links, fetches and analyzes content with Google Gemini AI, and displays a curated reading feed with summaries, categorization, and reading time estimates.

## Essential Commands

```bash
npm run dev          # Start development server at http://localhost:3000
npm run build        # Create production build
npm start            # Run production server
npm run lint         # Run ESLint
npx prisma dev       # Start local Prisma Postgres and apply migrations
npx prisma generate  # Generate Prisma client after schema changes
npx prisma studio    # Open Prisma Studio to view/edit data
```

## Technology Stack

- **Framework**: Next.js 16.1 with App Router
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: NextAuth.js v5 with Google OAuth (Gmail read scope)
- **AI**: Google Gemini API (`@google/genai` package)
- **UI**: React 19, Tailwind CSS v4, shadcn/ui components
- **Data Fetching**: SWR for client-side state

## Architecture

### Directory Structure
```
app/
├── (auth)/login/          # Login page (public)
├── (dashboard)/           # Protected dashboard routes
│   ├── feed/              # Main feed page
│   └── settings/          # User settings
├── api/
│   ├── auth/[...nextauth]/ # NextAuth route handler
│   ├── sync/              # POST: Trigger email sync
│   ├── links/             # GET: List links with filters
│   └── categories/        # GET: List categories
components/
├── ui/                    # shadcn/ui components
├── feed/                  # Feed display components
├── sync/                  # Sync button
└── layout/                # Header, sidebar
hooks/                     # SWR hooks (use-links, use-sync, use-categories)
lib/
├── prisma.ts              # Prisma client singleton
├── gmail.ts               # Gmail API integration
├── link-extractor.ts      # URL extraction from HTML
├── content-fetcher.ts     # Page fetching with Readability
├── gemini.ts              # Gemini AI analysis
└── utils.ts               # cn() utility from shadcn
```

### Key Files
- `auth.ts` - NextAuth configuration with Google OAuth + Gmail scope
- `proxy.ts` - Route protection for dashboard pages (Next.js 16 proxy convention)
- `prisma/schema.prisma` - Database schema (User, Email, Link, Category)

### Data Flow
1. User clicks "Sync Emails" → `POST /api/sync`
2. Fetch self-sent emails from Gmail API (`from:me to:me`)
3. Extract links from email content
4. Fetch each URL with Mozilla Readability for article parsing
5. Analyze with Gemini AI (summary, key points, category, tags, scores)
6. Store in PostgreSQL, display in feed

### Database Models
- **User**: NextAuth user with `lastSyncAt`
- **Email**: Gmail messages (gmailId, subject, content)
- **Link**: Extracted URLs with AI analysis fields:
  - `aiSummary`, `aiKeyPoints[]`, `aiCategory`, `aiTags[]`
  - `worthinessScore`, `uniquenessScore`, `isHighlighted`
  - `fetchStatus` enum: PENDING, FETCHING, FETCHED, ANALYZING, COMPLETED, FAILED, PAYWALL_DETECTED
- **Category**: For grouping links

## Environment Variables

Required in `.env`:
```
DATABASE_URL="..."           # PostgreSQL connection string
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="..."        # Generate with: openssl rand -base64 32
GOOGLE_CLIENT_ID="..."       # Google OAuth client ID
GOOGLE_CLIENT_SECRET="..."   # Google OAuth client secret
GEMINI_API_KEY="..."         # Google AI Studio API key
```

## Google Cloud Setup

1. Create project in Google Cloud Console
2. Enable Gmail API
3. Create OAuth 2.0 credentials (Web application)
4. Add redirect URI: `http://localhost:3000/api/auth/callback/google`
5. Configure OAuth consent screen with `gmail.readonly` scope
6. Get Gemini API key from Google AI Studio
