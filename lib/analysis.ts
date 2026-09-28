import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"
import { buildClientRegistry } from "@/lib/baml-registry"
import type { ResolvedSettings } from "@/lib/settings"
import type { AiKeys } from "@/lib/user-keys"

// Automatic analysis (sync, worker) skips a link once it has failed this many
// times; the Digest page's "Analyze again" still runs it.
export const MAX_AUTO_ANALYSIS_ATTEMPTS = 3

// Below this many words of real text there is nothing worth summarizing,
// e.g. a post that only shares a link ("Title https://t.co/… via @ft").
// Non-X pages under 50 words are already rejected at fetch time
// (isPoorContent); this mainly catches X/oEmbed posts, which are exempt there.
export const MIN_ANALYZABLE_WORDS = 25

export interface AnalysisResult {
    success: boolean
    error?: string
    /** Not analyzed: too little text. The link is now "Not enough content". */
    skipped?: boolean
}

/**
 * Words of real text the analysis would see: links, @handles, "via @x" and
 * the oEmbed attribution ("— Name (@handle) January 17, 2026") don't count.
 */
export function analyzableWordCount(text: string | null | undefined): number {
    if (!text) return 0
    const cleaned = text
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z#0-9]+;/gi, " ")
        .replace(/[—–-]\s*[^—–\n]*\(@\w+\)\s*[A-Z][a-z]+ \d{1,2}, \d{4}/g, " ")
        .replace(/https?:\/\/\S+/g, " ")
        .replace(/\bpic\.twitter\.com\/\S+/g, " ")
        .replace(/\bvia\s+@\w+/gi, " ")
        .replace(/@\w+/g, " ")
    return cleaned.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
}

/** The text analysis will run on, for the word-count check. */
export function analyzableText(link: { contentText?: string | null; rawHtml?: string | null }) {
    return link.contentText || link.rawHtml || null
}

/**
 * Mark a link "Not enough content" instead of analyzing it. Any earlier
 * analysis is cleared, since it was made from the same too-thin text.
 */
export async function markInsufficientContent(userId: string, linkIds: string[]): Promise<void> {
    if (linkIds.length === 0) return
    await prisma.link.updateMany({
        where: { userId, id: { in: linkIds } },
        data: {
            fetchStatus: "PAYWALL_DETECTED",
            isPaywalled: true,
            paywallType: "insufficient_content",
            aiSummary: null,
            aiKeyPoints: [],
            aiCategory: null,
            linkTags: [],
            contentTags: [],
            metadataTags: [],
            analyzedAt: null,
            analysisError: null,
        },
    })
}

export interface LinkAnalysisInput {
    summary?: string | null
    keyPoints?: string[] | null
    tags?: Array<string | { toString(): string }> | null
    contentTags?: Array<string | { toString(): string }> | null
    metadataTags?: Array<string | { toString(): string }> | null
}

export function fieldsFromLinkAnalysis(bamlResult: LinkAnalysisInput) {
    const linkTags = bamlResult.tags?.map((tag) => String(tag)) || []
    const contentTags = bamlResult.contentTags?.map((tag) => String(tag)) || []
    const metadataTags = bamlResult.metadataTags?.map((tag) => String(tag)) || []
    const aiCategory = contentTags[0] || null

    const isPaywalled =
        metadataTags.includes("PAYMENT_REQUIRED") ||
        metadataTags.includes("SUBSCRIPTION_REQUIRED") ||
        metadataTags.includes("LOGIN_REQUIRED")

    let paywallType: string | null = null
    if (metadataTags.includes("PAYMENT_REQUIRED")) {
        paywallType = "hard"
    } else if (metadataTags.includes("SUBSCRIPTION_REQUIRED")) {
        paywallType = "soft"
    } else if (metadataTags.includes("LOGIN_REQUIRED")) {
        paywallType = "registration"
    }

    return {
        fetchStatus: "COMPLETED" as const,
        aiSummary: bamlResult.summary || null,
        aiKeyPoints: bamlResult.keyPoints?.filter((p) => p.trim()) || [],
        aiCategory,
        linkTags,
        contentTags,
        metadataTags,
        isPaywalled,
        paywallType,
        analyzedAt: new Date(),
        analysisError: null,
        analysisAttempts: 0,
    }
}

/**
 * Put links back to FETCHED and record why analysis failed, so the Digest
 * can show it and automatic retries stop after MAX_AUTO_ANALYSIS_ATTEMPTS.
 */
export async function recordAnalysisFailure(
    userId: string,
    linkIds: string[],
    error: string
): Promise<void> {
    if (linkIds.length === 0) return
    await prisma.link.updateMany({
        where: { userId, id: { in: linkIds } },
        data: {
            fetchStatus: "FETCHED",
            analysisError: error,
            analysisAttempts: { increment: 1 },
        },
    })
}

/**
 * Write analysis onto a link only if it belongs to userId.
 * Returns false when the row is missing or owned by someone else.
 */
export async function persistLinkAnalysis(
    linkId: string,
    userId: string,
    bamlResult: LinkAnalysisInput
): Promise<boolean> {
    const updated = await prisma.link.updateMany({
        where: { id: linkId, userId },
        data: fieldsFromLinkAnalysis(bamlResult),
    })
    return updated.count === 1
}

export async function analyzeLink(
    linkId: string,
    settings: ResolvedSettings,
    aiKeys: AiKeys | undefined,
    userId: string
): Promise<AnalysisResult> {
    try {
        const link = await prisma.link.findFirst({
            where: { id: linkId, userId },
            select: {
                id: true,
                url: true,
                title: true,
                rawHtml: true,
                contentText: true,
                fetchStatus: true,
            },
        })

        if (!link) {
            return { success: false, error: "Link not found" }
        }

        const words = analyzableWordCount(analyzableText(link))
        if (words < MIN_ANALYZABLE_WORDS) {
            await markInsufficientContent(userId, [link.id])
            return { success: false, skipped: true, error: `Not enough content to analyze (${words} words)` }
        }

        await prisma.link.updateMany({
            where: { id: linkId, userId },
            data: { fetchStatus: "ANALYZING" },
        })

        const anchorText = link.title || link.url
        const rawHtml = link.rawHtml || link.contentText || undefined

        try {
            const clientRegistry = buildClientRegistry(settings, aiKeys)
            const bamlResult = await b.IngestLink(link.url, anchorText, rawHtml, { clientRegistry })

            const ok = await persistLinkAnalysis(link.id, userId, bamlResult)
            if (!ok) {
                return { success: false, error: "Link not found for user" }
            }
            return { success: true }
        } catch (bamlError) {
            const error = bamlError instanceof Error ? bamlError.message : "Unknown BAML error"
            await recordAnalysisFailure(userId, [link.id], error)
            console.error(`[Analysis] Failed to analyze link ${link.id}:`, error)
            return { success: false, error }
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error"
        console.error(`[Analysis] Error processing link ${linkId}:`, msg)
        return { success: false, error: msg }
    }
}
