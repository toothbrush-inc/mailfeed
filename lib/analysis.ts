import { prisma } from "@/lib/prisma"
import { b } from "@/baml_client"
import { buildClientRegistry } from "@/lib/baml-registry"
import type { ResolvedSettings } from "@/lib/settings"

export interface AnalysisResult {
    success: boolean
    error?: string
}

export async function analyzeLink(
    linkId: string,
    settings: ResolvedSettings
): Promise<AnalysisResult> {
    try {
        const link = await prisma.link.findUnique({
            where: { id: linkId },
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

        // Mark as ANALYZING
        await prisma.link.update({
            where: { id: linkId },
            data: { fetchStatus: "ANALYZING" },
        })

        // Build BAML input
        const anchorText = link.title || link.url
        const rawHtml = link.rawHtml || link.contentText || undefined

        try {
            const clientRegistry = buildClientRegistry(settings)
            const bamlResult = await b.IngestLink(link.url, anchorText, rawHtml, { clientRegistry })

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

            await prisma.link.update({
                where: { id: link.id },
                data: {
                    fetchStatus: "COMPLETED",
                    aiSummary: bamlResult.summary || null,
                    aiCategory,
                    linkTags,
                    contentTags,
                    metadataTags,
                    isPaywalled,
                    paywallType,
                    analyzedAt: new Date(),
                },
            })

            return { success: true }
        } catch (bamlError) {
            // Revert status
            await prisma.link.update({
                where: { id: link.id },
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
