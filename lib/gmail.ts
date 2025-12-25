import { google } from "googleapis"
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

export async function getGmailClient(userId: string) {
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
  pageToken?: string
) {
  const gmail = await getGmailClient(userId)

  // Get user's email address
  const profile = await gmail.users.getProfile({ userId: "me" })
  const userEmail = profile.data.emailAddress

  // Query for self-sent emails
  const response = await gmail.users.messages.list({
    userId: "me",
    q: `from:${userEmail} to:${userEmail}`,
    maxResults,
    pageToken,
  })

  return {
    messages: response.data.messages || [],
    nextPageToken: response.data.nextPageToken,
  }
}

export async function getEmailContent(userId: string, messageId: string) {
  const gmail = await getGmailClient(userId)

  const message = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  })

  return parseEmailContent(message.data as GmailMessage)
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
