import { google, gmail_v1 } from "googleapis"
import { prisma } from "@/lib/prisma"

// Custom error for authentication issues that require re-login
export class AuthenticationError extends Error {
  code: string

  constructor(message: string, code: string = "AUTH_REQUIRED") {
    super(message)
    this.name = "AuthenticationError"
    this.code = code
  }
}

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
    throw new AuthenticationError("No Google account connected", "NO_ACCOUNT")
  }

  // Check that the stored token has the Gmail scope
  const grantedScopes = account.scope || ""
  if (!grantedScopes.includes("gmail.readonly")) {
    throw new AuthenticationError(
      "Gmail access was not granted. Please sign out, revoke MailFeed at https://myaccount.google.com/permissions, and sign in again to grant Gmail access.",
      "INSUFFICIENT_SCOPE"
    )
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

  // Try to refresh the token proactively to catch invalid_grant early
  try {
    const tokenInfo = await oauth2Client.getAccessToken()
    if (!tokenInfo.token) {
      throw new AuthenticationError("Failed to get access token", "TOKEN_REFRESH_FAILED")
    }
  } catch (error: unknown) {
    // Log the full error for debugging
    console.error("[Gmail] Token refresh error:", {
      error,
      errorType: error?.constructor?.name,
      message: error instanceof Error ? error.message : String(error),
      // Google API errors often have these properties
      code: (error as { code?: string })?.code,
      status: (error as { status?: number })?.status,
      response: (error as { response?: { data?: unknown } })?.response?.data,
    })

    // Check for invalid_grant or other auth errors
    if (error instanceof Error) {
      const errorMessage = error.message.toLowerCase()
      const errorCode = (error as { code?: string })?.code?.toLowerCase() || ""

      if (
        errorMessage.includes("invalid_grant") ||
        errorMessage.includes("token has been expired or revoked") ||
        errorMessage.includes("refresh token") ||
        errorMessage.includes("invalid_client") ||
        errorCode === "invalid_grant"
      ) {
        throw new AuthenticationError(
          `Your Google session has expired. Please sign in again. (${error.message})`,
          "INVALID_GRANT"
        )
      }
    }
    throw error
  }

  return google.gmail({ version: "v1", auth: oauth2Client })
}

// Helper to check if an error is an insufficient scopes error (403)
function isInsufficientScopeError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    const status = (error as { status?: number })?.status
    return status === 403 && message.includes("insufficient authentication scopes")
  }
  return false
}

// Helper to check if an error is an auth error
function isAuthError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase()
    const code = String((error as { code?: string | number })?.code || "").toLowerCase()
    const status = (error as { status?: number })?.status
    const rawResponseError = (error as { response?: { data?: { error?: unknown } } })?.response?.data?.error
    const responseError = (typeof rawResponseError === "string" ? rawResponseError : "").toLowerCase()

    return (
      message.includes("invalid_grant") ||
      message.includes("token has been expired or revoked") ||
      message.includes("invalid_credentials") ||
      message.includes("unauthorized") ||
      code === "invalid_grant" ||
      code === "401" ||
      status === 401 ||
      responseError === "invalid_grant"
    )
  }
  return false
}

// Wrapper to handle Gmail API errors
async function handleGmailApiError(error: unknown): Promise<never> {
  console.error("[Gmail API] Error details:", {
    errorType: error?.constructor?.name,
    message: error instanceof Error ? error.message : String(error),
    code: (error as { code?: string })?.code,
    status: (error as { status?: number })?.status,
    errors: (error as { errors?: unknown[] })?.errors,
    response: (error as { response?: { data?: unknown } })?.response?.data,
  })

  if (isInsufficientScopeError(error)) {
    throw new AuthenticationError(
      "Gmail access was not granted. Please sign out, revoke MailFeed at https://myaccount.google.com/permissions, and sign in again to grant Gmail access.",
      "INSUFFICIENT_SCOPE"
    )
  }

  if (isAuthError(error)) {
    throw new AuthenticationError(
      `Google authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      "INVALID_GRANT"
    )
  }
  throw error
}

export async function fetchEmails(
  userId: string,
  query: string,
  maxResults: number = 50,
  pageToken?: string,
  gmail?: GmailClient
) {
  const client = gmail || await getGmailClient(userId)

  try {
    // Resolve "me" placeholders in the query to the user's actual email
    let resolvedQuery = query
    if (query.includes("me")) {
      const profile = await client.users.getProfile({ userId: "me" })
      const userEmail = profile.data.emailAddress
      resolvedQuery = query.replace(/\bfrom:me\b/g, `from:${userEmail}`).replace(/\bto:me\b/g, `to:${userEmail}`)
    }

    const response = await client.users.messages.list({
      userId: "me",
      q: resolvedQuery,
      maxResults,
      pageToken,
    })

    return {
      messages: response.data.messages || [],
      nextPageToken: response.data.nextPageToken,
      resultSizeEstimate: response.data.resultSizeEstimate || 0,
      gmail: client,
    }
  } catch (error) {
    return handleGmailApiError(error)
  }
}

/** @deprecated Use fetchEmails instead */
export const fetchSelfEmails = (
  userId: string,
  maxResults?: number,
  pageToken?: string,
  gmail?: GmailClient
) => fetchEmails(userId, "from:me to:me", maxResults, pageToken, gmail)

/**
 * Get the estimated count of emails matching a query
 */
export async function getEmailCount(userId: string, query: string, gmail?: GmailClient) {
  const client = gmail || await getGmailClient(userId)

  try {
    let resolvedQuery = query
    if (query.includes("me")) {
      const profile = await client.users.getProfile({ userId: "me" })
      const userEmail = profile.data.emailAddress
      resolvedQuery = query.replace(/\bfrom:me\b/g, `from:${userEmail}`).replace(/\bto:me\b/g, `to:${userEmail}`)
    }

    const response = await client.users.messages.list({
      userId: "me",
      q: resolvedQuery,
      maxResults: 1,
    })

    return {
      estimate: response.data.resultSizeEstimate || 0,
      gmail: client,
    }
  } catch (error) {
    return handleGmailApiError(error)
  }
}

/** @deprecated Use getEmailCount instead */
export const getSelfEmailCount = (userId: string, gmail?: GmailClient) =>
  getEmailCount(userId, "from:me to:me", gmail)

export async function getEmailContent(
  userId: string,
  messageId: string,
  gmail?: GmailClient
) {
  const client = gmail || await getGmailClient(userId)

  try {
    const message = await client.users.messages.get({
      userId: "me",
      id: messageId,
      format: "full",
    })

    return parseEmailContent(message.data as GmailMessage)
  } catch (error) {
    return handleGmailApiError(error)
  }
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
          // Check if this is an auth error - if so, throw it to stop the sync
          if (isAuthError(error)) {
            throw new AuthenticationError(
              `Google authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              "INVALID_GRANT"
            )
          }
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
