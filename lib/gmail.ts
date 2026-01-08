import { google, gmail_v1 } from "googleapis"
import { prisma } from "@/lib/prisma"

interface GmailMessage {
  id: string
  threadId: string
  snippet: string
  payload: {
    headers: Array<{ name: string; value: string }>
    body?: { data?: string }
    parts?: Array<{
      mimeType: string
      body?: { data?: string }
      parts?: Array<unknown>
    }>
  }
  internalDate: string
}

export type GmailClient = gmail_v1.Gmail

export async function getGmailClient(userId: string): Promise<GmailClient> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  })

  if (!account?.access_token) {
    throw new Error("No Google account connected")
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  )

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  })

  // Handle token refresh
  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await prisma.account.update({
        where: { id: account.id },
        data: {
          access_token: tokens.access_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : undefined,
        },
      })
    }
  })

  return google.gmail({ version: "v1", auth: oauth2Client })
}

export async function fetchSelfEmails(
  userId: string,
  maxResults: number = 50,
  pageToken?: string,
  gmail?: GmailClient
) {
  const client = gmail || await getGmailClient(userId)

  // Get user's email address
  const profile = await client.users.getProfile({ userId: "me" })
  const userEmail = profile.data.emailAddress

  // Query for self-sent emails
  const response = await client.users.messages.list({
    userId: "me",
    q: `from:${userEmail} to:${userEmail}`,
    maxResults,
    pageToken,
  })

  return {
    messages: response.data.messages || [],
    nextPageToken: response.data.nextPageToken,
    resultSizeEstimate: response.data.resultSizeEstimate || 0,
    gmail: client, // Return the client for reuse
  }
}

/**
 * Get the estimated count of self-sent emails
 */
export async function getSelfEmailCount(userId: string, gmail?: GmailClient) {
  const client = gmail || await getGmailClient(userId)

  // Get user's email address
  const profile = await client.users.getProfile({ userId: "me" })
  const userEmail = profile.data.emailAddress

  // Query just to get the count estimate
  const response = await client.users.messages.list({
    userId: "me",
    q: `from:${userEmail} to:${userEmail}`,
    maxResults: 1,
  })

  return {
    estimate: response.data.resultSizeEstimate || 0,
    gmail: client,
  }
}

export async function getEmailContent(
  userId: string,
  messageId: string,
  gmail?: GmailClient
) {
  const client = gmail || await getGmailClient(userId)

  const message = await client.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  })

  return parseEmailContent(message.data as GmailMessage)
}

// Batch fetch multiple emails in parallel with concurrency limit
export async function batchGetEmailContents(
  messageIds: string[],
  gmail: GmailClient,
  concurrency: number = 10
) {
  const results: Array<ReturnType<typeof parseEmailContent> | null> = []

  // Process in batches
  for (let i = 0; i < messageIds.length; i += concurrency) {
    const batch = messageIds.slice(i, i + concurrency)
    const batchResults = await Promise.all(
      batch.map(async (id) => {
        try {
          const message = await gmail.users.messages.get({
            userId: "me",
            id,
            format: "full",
          })
          return parseEmailContent(message.data as GmailMessage)
        } catch (error) {
          console.error(`Failed to fetch email ${id}:`, error)
          return null
        }
      })
    )
    results.push(...batchResults)
  }

  return results
}

function parseEmailContent(message: GmailMessage) {
  const headers = message.payload.headers
  const subject = headers.find((h) => h.name.toLowerCase() === "subject")?.value

  // Extract body content (handle multipart)
  let bodyContent = ""

  if (message.payload.body?.data) {
    bodyContent = Buffer.from(message.payload.body.data, "base64").toString("utf-8")
  } else if (message.payload.parts) {
    bodyContent = extractPartsContent(message.payload.parts)
  }

  return {
    id: message.id,
    threadId: message.threadId,
    subject,
    snippet: message.snippet,
    receivedAt: new Date(parseInt(message.internalDate)),
    content: bodyContent,
  }
}

function extractPartsContent(parts: Array<unknown>): string {
  let content = ""

  for (const part of parts as Array<{
    mimeType: string
    body?: { data?: string }
    parts?: Array<unknown>
  }>) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      content += Buffer.from(part.body.data, "base64").toString("utf-8")
    } else if (part.mimeType === "text/html" && part.body?.data) {
      content += Buffer.from(part.body.data, "base64").toString("utf-8")
    } else if (part.parts) {
      content += extractPartsContent(part.parts)
    }
  }

  return content
}
