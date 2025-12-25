import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { fetchSelfEmails, getEmailContent } from "@/lib/gmail"
import { extractLinks, hashUrl, extractDomain } from "@/lib/link-extractor"
import { fetchAndParseContent, estimateReadingTime } from "@/lib/content-fetcher"
import { analyzeContent } from "@/lib/gemini"

export async function POST() {
  const session = await auth()

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id

  const syncResults = {
    emailsProcessed: 0,
    linksExtracted: 0,
    linksFetched: 0,
    linksAnalyzed: 0,
    errors: [] as string[],
  }

  try {
    // Step 1: Fetch self-emails from Gmail
    const { messages } = await fetchSelfEmails(userId, 50)

    for (const msg of messages) {
      if (!msg.id) continue

      // Check if email already processed
      const existingEmail = await prisma.email.findUnique({
        where: { gmailId: msg.id },
      })

      if (existingEmail) continue

      try {
        // Fetch full email content
        const emailData = await getEmailContent(userId, msg.id)

        // Save email to database
        const email = await prisma.email.create({
          data: {
            userId,
            gmailId: emailData.id,
            threadId: emailData.threadId,
            subject: emailData.subject,
            snippet: emailData.snippet,
            receivedAt: emailData.receivedAt,
            rawContent: emailData.content,
            processedAt: new Date(),
          },
        })

        syncResults.emailsProcessed++

        // Extract links from email
        const links = extractLinks(emailData.content)

        for (const url of links) {
          const urlHash = hashUrl(url)

          // Check for duplicate
          const existingLink = await prisma.link.findUnique({
            where: { userId_urlHash: { userId, urlHash } },
          })

          if (existingLink) continue

          // Create link record
          const link = await prisma.link.create({
            data: {
              userId,
              emailId: email.id,
              url,
              urlHash,
              domain: extractDomain(url),
              fetchStatus: "PENDING",
            },
          })

          syncResults.linksExtracted++

          // Fetch content
          try {
            await prisma.link.update({
              where: { id: link.id },
              data: { fetchStatus: "FETCHING" },
            })

            const content = await fetchAndParseContent(url)

            if (!content.success) {
              await prisma.link.update({
                where: { id: link.id },
                data: {
                  fetchStatus: content.isPaywalled ? "PAYWALL_DETECTED" : "FAILED",
                  fetchError: content.error,
                  isPaywalled: content.isPaywalled || false,
                  paywallType: content.paywallType,
                  fetchedAt: new Date(),
                },
              })
              continue
            }

            await prisma.link.update({
              where: { id: link.id },
              data: {
                fetchStatus: "FETCHED",
                title: content.title,
                description: content.excerpt,
                imageUrl: content.imageUrl,
                contentText: content.textContent,
                wordCount: content.wordCount,
                readingTimeMin: content.wordCount
                  ? estimateReadingTime(content.wordCount)
                  : null,
                isPaywalled: content.isPaywalled || false,
                paywallType: content.paywallType,
                fetchedAt: new Date(),
              },
            })

            syncResults.linksFetched++

            // Analyze with AI if we have content
            if (content.textContent && content.title) {
              try {
                await prisma.link.update({
                  where: { id: link.id },
                  data: { fetchStatus: "ANALYZING" },
                })

                const analysis = await analyzeContent(content.title, content.textContent)

                // Ensure category exists
                const category = await prisma.category.upsert({
                  where: { name: analysis.category },
                  create: {
                    name: analysis.category,
                    slug: analysis.category.toLowerCase().replace(/\s+/g, "-"),
                  },
                  update: {},
                })

                await prisma.link.update({
                  where: { id: link.id },
                  data: {
                    fetchStatus: "COMPLETED",
                    aiSummary: analysis.summary,
                    aiKeyPoints: analysis.keyPoints,
                    aiCategory: analysis.category,
                    aiTags: analysis.tags,
                    worthinessScore: analysis.worthinessScore,
                    uniquenessScore: analysis.uniquenessScore,
                    isHighlighted: analysis.isHighlighted,
                    highlightReason: analysis.highlightReason,
                    analyzedAt: new Date(),
                    categories: {
                      create: {
                        categoryId: category.id,
                        confidence: 1.0,
                      },
                    },
                  },
                })

                syncResults.linksAnalyzed++
              } catch (analysisError) {
                // Mark as fetched but not analyzed
                await prisma.link.update({
                  where: { id: link.id },
                  data: { fetchStatus: "FETCHED" },
                })
                syncResults.errors.push(
                  `AI analysis failed for ${url}: ${analysisError}`
                )
              }
            }
          } catch (fetchError) {
            syncResults.errors.push(`Failed to process ${url}: ${fetchError}`)
            await prisma.link.update({
              where: { id: link.id },
              data: {
                fetchStatus: "FAILED",
                fetchError:
                  fetchError instanceof Error ? fetchError.message : "Unknown error",
              },
            })
          }
        }
      } catch (emailError) {
        syncResults.errors.push(
          `Failed to process email ${msg.id}: ${emailError}`
        )
      }
    }

    // Update user's last sync time
    await prisma.user.update({
      where: { id: userId },
      data: { lastSyncAt: new Date() },
    })

    return NextResponse.json(syncResults)
  } catch (error) {
    console.error("Sync error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    )
  }
}
