import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"
import { buildClientRegistry } from "@/lib/baml-registry"
import type { ResolvedSettings } from "@/lib/settings"
import type { AiKeys } from "@/lib/user-keys"

export interface AnalysisResult {
    success: boolean
    error?: string
}

export interface LinkAnalysisInput {
    summary?: string | null
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
        aiCategory,
        linkTags,
        contentTags,
        metadataTags,
        isPaywalled,
        paywallType,
        analyzedAt: new Date(),
    }
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
            await prisma.link.updateMany({
                where: { id: link.id, userId },
                data: { fetchStatus: "FETCHED" },
            })
            const error = bamlError instanceof Error ? bamlError.message : "Unknown BAML error"
            console.error(`[Analysis] Failed to analyze link ${link.id}:`, error)
            return { success: false, error }
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error"
        console.error(`[Analysis] Error processing link ${linkId}:`, msg)
        return { success: false, error: msg }
    }
}
