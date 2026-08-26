# Encryption at rest

When a master key is configured, MailFeed encrypts each user's sensitive
data with a key that belongs to that user, so the database (and its dumps,
snapshots, and backups) holds ciphertext, and one user's key can never
decrypt another user's rows.

Without a master key nothing changes: data is stored as it always was, so
the self-hosted quick start works untouched. Encryption is for instances
hosting other people's mail.

## What is encrypted

| Data | Columns |
|---|---|
| Email content | `Email.subject`, `Email.snippet`, `Email.rawContent` |
| Gmail OAuth tokens | `Account.access_token`, `Account.refresh_token`, `Account.id_token` |
| BYOK LLM API keys | `User.apiKeysEnc` |

Deliberately **not** encrypted: link/article content fetched from public
URLs (encrypting it would break feed search for no privacy gain) and
embedding vectors (which must stay plaintext to be searchable — they are a
lossy, topic-level projection of the text; treat them accordingly).

## How it works

- Each user gets a random 256-bit **DEK** on first write, used with
  AES-256-GCM per field. Ciphertext is self-describing:
  `enc.v1.<userId>.<iv>.<ciphertext>`.
- The DEK is stored wrapped (`User.dekWrapped`) by a **KEK**: Cloud KMS in
  production (`KMS_KEY_NAME`, ADC/IAM, audit-logged) or a local key
  (`MAILFEED_KEK`). Neither configured → encryption is off (one startup
  warning). Hosted instances set `MAILFEED_REQUIRE_ENCRYPTION=true`, which
  turns a missing KEK into a hard error instead of a silent downgrade.
  Storing per-user BYOK API keys always requires encryption.
- A Prisma client extension (`lib/crypto/prisma-encryption.ts`) encrypts the
  listed columns on write and decrypts any `enc.v1.` string in any read
  result — nested includes and raw SQL included. Application code is
  unaware of the encryption.
- Stored API keys use a different prefix (`enck.v1.`) that the transparent
  read path refuses to decrypt; only `lib/user-keys.ts` opens them, and API
  responses only ever contain last-4 masks.
- Deleting a user cascades their rows and destroys `dekWrapped` with them —
  crypto-shredding: even a leaked backup of their rows is unreadable.

Values without the prefix pass through untouched, so a database predating
encryption keeps working; rows encrypt as they are next written.

## Consequences

- Email substring search decrypts and filters in the app
  (`lib/email-search.ts`, used by the emails list and chat's text fallback)
  instead of `ILIKE` in SQL — O(mailbox), fine at personal scale. Link
  titles/summaries stay SQL-searchable.
- The operator of the KEK (or of the KMS key's IAM) can still technically
  decrypt; this is standard hosted-service envelope encryption, not
  end-to-end. The format is versioned so a user-held wrapping key could be
  added later.

## Tenant isolation

Encryption at rest is not access control: ciphertext carries the owner's
user id, so a query that returns another user's row would still decrypt.
Mailboxes stay private because:

- Every email list/search/count requires `where.userId` (enforced by
  `lib/tenant-guard.ts`). Unscoped `findMany` throws rather than returning
  mixed mailboxes.
- API handlers that take an email or link id from the client look up
  `{ id, userId: session.user.id }` before decrypting nested email bodies.
- Gmail message ids are unique per user (`@@unique([userId, gmailId])`),
  not globally, so one account cannot collide with or skip another's sync.
- Chat and vector search SQL already filter `Email`/`Link` by `userId`.

## Verifying

```
docker run -d --name mailfeed-crypto-test -e POSTGRES_PASSWORD=test \
  -e POSTGRES_DB=mailfeed_test -p 5599:5432 pgvector/pgvector:pg16
DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test npx prisma migrate deploy
DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
  MAILFEED_KEK=$(openssl rand -base64 32) npm run test:encryption
DATABASE_URL=postgresql://postgres:test@localhost:5599/mailfeed_test \
  npm run test:isolation
docker rm -f mailfeed-crypto-test
```
