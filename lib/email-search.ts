import { prisma } from "@/lib/prisma"

// subject/snippet/rawContent are encrypted at rest, so the database cannot
// substring-match them. Decrypt (transparently, via the Prisma extension)
// and filter here. O(user's mailbox), which is fine at personal scale.

export function emailTextMatches(
  email: { subject?: string | null; snippet?: string | null; rawContent?: string | null },
  searchTerm: string
): boolean {
  const needle = searchTerm.toLowerCase()
  return [email.subject, email.snippet, email.rawContent].some((v) =>
    v?.toLowerCase().includes(needle)
  )
}

/** IDs of the user's emails whose decrypted subject/snippet/body contain `searchTerm`. */
export async function findEmailIdsMatchingText(
  userId: string,
  searchTerm: string
): Promise<string[]> {
  const candidates = await prisma.email.findMany({
    where: { userId },
    select: { id: true, subject: true, snippet: true, rawContent: true },
  })
  return candidates.filter((email) => emailTextMatches(email, searchTerm)).map((email) => email.id)
}

export interface EmailTextHit {
  id: string
  subject: string | null
  snippet: string | null
  receivedAt: Date
  similarity: number
}

/** Newest-first text hits, capped at `limit`. Used by chat's vector-search fallback. */
export async function textSearchEmails(
  userId: string,
  searchTerm: string,
  limit: number = 10
): Promise<EmailTextHit[]> {
  const candidates = await prisma.email.findMany({
    where: { userId },
    select: { id: true, subject: true, snippet: true, rawContent: true, receivedAt: true },
    orderBy: { receivedAt: "desc" },
  })
  const hits: EmailTextHit[] = []
  for (const email of candidates) {
    if (!emailTextMatches(email, searchTerm)) continue
    hits.push({
      id: email.id,
      subject: email.subject,
      snippet: email.snippet,
      receivedAt: email.receivedAt,
      similarity: 0.5,
    })
    if (hits.length >= limit) break
  }
  return hits
}
