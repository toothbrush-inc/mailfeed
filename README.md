# MailFeed

A personal reading feed that extracts links from your self-sent Gmail emails, fetches article content, and provides AI-powered summaries and categorization.

## Features

- **Gmail Integration**: Syncs emails you send to yourself (`from:me to:me`)
- **Link Extraction**: Automatically extracts and deduplicates links from emails
- **Content Fetching**: Fetches article content using Mozilla Readability, with Wayback Machine fallback
- **AI Analysis**: Summarizes articles, extracts key points, categorizes, and scores content using Google Gemini
- **Semantic Search (RAG)**: Chat with your saved links using vector similarity search
- **Reading Feed**: Clean interface to browse, filter, and search your saved content

## Prerequisites

- Node.js 18+
- Docker (for PostgreSQL with pgvector)
- Google Cloud account (for Gmail API and Gemini)

## Quick Start

### 1. Clone and Install

```bash
git clone <repo-url>
cd mailfeed
npm install
```

### 2. Start PostgreSQL with pgvector

```bash
docker compose up -d
```

This starts PostgreSQL 16 with the pgvector extension pre-installed.

### 3. Configure Environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Required variables:

```env
# Database (matches docker-compose defaults)
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/mailfeed"

# NextAuth
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="<generate with: openssl rand -base64 32>"

# Google OAuth (for Gmail access)
GOOGLE_CLIENT_ID="<your-google-client-id>"
GOOGLE_CLIENT_SECRET="<your-google-client-secret>"

# Google Gemini API
GEMINI_API_KEY="<your-gemini-api-key>"
```

### 4. Set Up the Database

```bash
# Push Prisma schema to database
npx prisma db push

# Enable pgvector extension and create embedding columns
docker exec mailfeed-postgres-v2 psql -U postgres -d mailfeed -c "CREATE EXTENSION IF NOT EXISTS vector;"
npx prisma db execute --file prisma/migrations/20250111000000_add_vector_embeddings/migration.sql
```

### 5. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to use the app.

## Google Cloud Setup

### Gmail API + OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Gmail API**
4. Go to **APIs & Services > Credentials**
5. Create **OAuth 2.0 Client ID** (Web application)
6. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
7. Copy the Client ID and Client Secret to your `.env`

### OAuth Consent Screen

1. Go to **APIs & Services > OAuth consent screen**
2. Configure the consent screen (External or Internal)
3. Add scope: `https://www.googleapis.com/auth/gmail.readonly`
4. Add your email as a test user (if using External)

### Gemini API

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Create an API key
3. Copy it to `GEMINI_API_KEY` in your `.env`

## Docker Commands

```bash
# Start PostgreSQL
docker compose up -d

# Stop PostgreSQL (data persists)
docker compose down

# Stop and delete all data
docker compose down -v

# View logs
docker compose logs -f postgres

# Connect to database
docker exec -it mailfeed-postgres-v2 psql -U postgres -d mailfeed
```

## Development Commands

```bash
npm run dev          # Start development server
npm run build        # Create production build
npm run start        # Run production server
npm run lint         # Run ESLint

# Prisma
npx prisma db push   # Push schema changes to database
npx prisma generate  # Generate Prisma client
npx prisma studio    # Open database GUI
```

## Semantic Search (RAG)

MailFeed supports AI-powered semantic search using pgvector embeddings:

1. **Check Status**: Go to Settings to see embedding coverage
2. **Generate Embeddings**: Click "Generate Embeddings" to process your links
3. **Use Chat**: The chatbot will use semantic similarity to find relevant content

Embeddings are generated using Gemini's `text-embedding-004` model (768 dimensions).

## Architecture

```
app/
├── (auth)/login/          # Login page
├── (dashboard)/           # Protected routes
│   ├── feed/              # Main reading feed
│   ├── emails/            # Email list view
│   ├── settings/          # User settings
│   └── reports/           # Reported links (admin)
├── api/
│   ├── sync/              # Email sync endpoint
│   ├── links/             # Link CRUD operations
│   ├── chat/              # RAG chatbot
│   └── embeddings/        # Embedding generation
components/
├── ui/                    # shadcn/ui components
├── feed/                  # Feed display components
└── layout/                # Header, sidebar
lib/
├── prisma.ts              # Database client
├── gmail.ts               # Gmail API integration
├── content-fetcher.ts     # Article content extraction
├── gemini.ts              # AI analysis
├── embeddings.ts          # Vector embeddings
└── vector-search.ts       # Similarity search
```

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL + pgvector
- **ORM**: Prisma
- **Auth**: NextAuth.js v5
- **AI**: Google Gemini (analysis + embeddings)
- **UI**: React 19, Tailwind CSS v4, shadcn/ui
- **Data Fetching**: SWR

## License

MIT
