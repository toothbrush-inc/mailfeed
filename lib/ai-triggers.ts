import { getUserSettings } from "@/lib/user-settings"
import { analyzeLink } from "@/lib/analysis"
import { generateAndStoreEmbedding } from "@/lib/embeddings"
import { isAiConfigured } from "@/lib/ai-provider"
import { FEATURE_FLAGS } from "@/lib/flags"

export async function triggerAutoAnalysisAndEmbedding(
    linkId: string,
    userId: string
) {
    try {
        const settings = await getUserSettings(userId)

        if (!isAiConfigured(settings)) {
            console.log("[AI Triggers] Skipping - AI not configured")
            return
        }

        // 1. Analysis
        if (FEATURE_FLAGS.enableAnalysis && settings.analysis.enabled && settings.analysis.autoRun) {
            console.log(`[AI Triggers] Triggering auto-analysis for link ${linkId}`)
            // Fire and forget, but log error if it fails
            analyzeLink(linkId, settings).then((result) => {
                if (!result.success) {
                    console.error(`[AI Triggers] Auto-analysis failed for ${linkId}:`, result.error)
                }
            })
        } else {
            console.log("[AI Triggers] Skipping analysis - disabled or autoRun off")
        }

        // 2. Embeddings
        if (settings.embeddings.enabled && settings.embeddings.autoRun) {
            console.log(`[AI Triggers] Triggering auto-embedding for link ${linkId}`)
            // Fire and forget
            generateAndStoreEmbedding(linkId, settings).then((result) => {
                if (!result.success) {
                    console.error(`[AI Triggers] Auto-embedding failed for ${linkId}:`, result.error)
                }
            })
        } else {
            console.log("[AI Triggers] Skipping embeddings - disabled or autoRun off")
        }

    } catch (error) {
        console.error("[AI Triggers] Error loading settings or triggering AI:", error)
    }
}
