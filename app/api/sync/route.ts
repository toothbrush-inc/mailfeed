import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { prisma } from "@/lib/prisma"
import { fetchSelfEmails, getEmailContent } from "@/lib/gmail"
import { extractLinks, hashUrl, extractDomain, EXCLUDED_DOMAINS } from "@/lib/link-extractor"
import { fetchAndParseContent, estimateReadingTime, isPoorContent } from "@/lib/content-fetcher"
import { analyzeContent } from "@/lib/gemini"
import { parseHtmlWithAI } from "@/lib/ai-html-parser"
import { processNestedLinks } from "@/lib/process-nested-links"

// Helper to check if a URL should be excluded
const isExcludedUrl = (url: string) => {
  const lowerUrl = url.toLowerCase()
  return EXCLUDED_DOMAINS.some((d) => lowerUrl.includes(d))
}

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
    linksSkippedExcluded: 0,
    linksSkippedDuplicate: 0,
    nestedLinksCreated: 0,
    nestedLinksFetched: 0,
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
            const rawHtml = content.rawHtml

            // Check if we need AI fallback for poor content
            if (isPoorContent(content) && rawHtml) {
              console.log(`[Sync] Poor content detected, using AI fallback: ${url}`)

              try {
                const aiResult = await parseHtmlWithAI(url, rawHtml)

                // Check exclusions on final URL before saving
                if (content.finalUrl && isExcludedUrl(content.finalUrl)) {
                  console.log(`[Sync] Skipping link - final URL excluded: ${url} -> ${content.finalUrl}`)
                  await prisma.link.delete({ where: { id: link.id } })
                  syncResults.linksSkippedExcluded++
                  continue
                }

                // Check for duplicate by final URL
                const finalUrlHash = content.finalUrl ? hashUrl(content.finalUrl) : null
                if (finalUrlHash) {
                  const existingByFinalUrl = await prisma.link.findFirst({
                    where: {
                      userId,
                      finalUrlHash,
                      id: { not: link.id },
                    },
                  })

                  if (existingByFinalUrl) {
                    console.log(`[Sync] Skipping link - duplicate final URL: ${url} -> ${content.finalUrl}`)
                    await prisma.link.delete({ where: { id: link.id } })
                    syncResults.linksSkippedDuplicate++
                    continue
                  }
                }

                // Save AI-parsed content
                await prisma.link.update({
                  where: { id: link.id },
                  data: {
                    fetchStatus: "COMPLETED",
                    aiSummary: aiResult.summary,
                    aiCategory: aiResult.aiCategory,
                    linkTags: aiResult.linkTags,
                    contentTags: aiResult.contentTags,
                    metadataTags: aiResult.metadataTags,
                    isPaywalled: aiResult.isPaywalled,
                    paywallType: aiResult.paywallType,
                    rawHtml: rawHtml,
                    finalUrl: content.finalUrl,
                    finalUrlHash,
                    finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
                    wasRedirected: content.wasRedirected || false,
                    fetchedAt: new Date(),
                    analyzedAt: new Date(),
                  },
                })

                syncResults.linksFetched++
                syncResults.linksAnalyzed++
                console.log(`[Sync] AI fallback succeeded for: ${url}`)

                // Process nested links from social media posts
                const nestedResult = await processNestedLinks({
                  id: link.id,
                  userId,
                  emailId: email.id,
                  rawHtml: rawHtml,
                  finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
                  domain: extractDomain(url),
                })
                syncResults.nestedLinksCreated += nestedResult.created
                syncResults.nestedLinksFetched += nestedResult.fetched
                syncResults.errors.push(...nestedResult.errors)

                continue
              } catch (aiError) {
                console.error(`[Sync] AI fallback failed for ${url}:`, aiError)
                // Fall through to normal failure handling
              }
            }

            if (!content.success) {
              await prisma.link.update({
                where: { id: link.id },
                data: {
                  fetchStatus: content.isPaywalled ? "PAYWALL_DETECTED" : "FAILED",
                  fetchError: content.error,
                  isPaywalled: content.isPaywalled || false,
                  paywallType: content.paywallType,
                  rawHtml: rawHtml,
                  finalUrl: content.finalUrl,
                  finalUrlHash: content.finalUrl ? hashUrl(content.finalUrl) : null,
                  finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
                  wasRedirected: content.wasRedirected || false,
                  fetchedAt: new Date(),
                },
              })
              continue
            }

            // Check if final URL is in excluded domains
            if (content.finalUrl && isExcludedUrl(content.finalUrl)) {
              console.log(`[Sync] Skipping link - final URL excluded: ${url} -> ${content.finalUrl}`)
              await prisma.link.delete({ where: { id: link.id } })
              syncResults.linksSkippedExcluded++
              continue
            }

            // Check for duplicate by final URL
            const finalUrlHash = content.finalUrl ? hashUrl(content.finalUrl) : null
            if (finalUrlHash) {
              const existingByFinalUrl = await prisma.link.findFirst({
                where: {
                  userId,
                  finalUrlHash,
                  id: { not: link.id }, // Exclude current link
                },
              })

              if (existingByFinalUrl) {
                console.log(`[Sync] Skipping link - duplicate final URL: ${url} -> ${content.finalUrl}`)
                await prisma.link.delete({ where: { id: link.id } })
                syncResults.linksSkippedDuplicate++
                continue
              }
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
                finalUrl: content.finalUrl,
                finalUrlHash,
                finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
                wasRedirected: content.wasRedirected || false,
                fetchedAt: new Date(),
              },
            })

            syncResults.linksFetched++

            // Process nested links from social media posts
            const nestedResult = await processNestedLinks({
              id: link.id,
              userId,
              emailId: email.id,
              rawHtml: content.rawHtml || null,
              finalDomain: content.finalUrl ? extractDomain(content.finalUrl) : null,
              domain: extractDomain(url),
            })
            syncResults.nestedLinksCreated += nestedResult.created
            syncResults.nestedLinksFetched += nestedResult.fetched
            syncResults.errors.push(...nestedResult.errors)

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
