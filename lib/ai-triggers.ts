import { getUserSettings } from "@/lib/user-settings"
import { getUserAiKeys, resolveGeminiKey } from "@/lib/user-keys"
import { analyzeLink } from "@/lib/analysis"
import { generateAndStoreEmbedding } from "@/lib/embeddings"
import { isAiConfigured } from "@/lib/ai-provider"
import { FEATURE_FLAGS } from "@/lib/flags"

export async function triggerAutoAnalysisAndEmbedding(
    linkId: string,
    userId: string
) {
    try {
        const [settings, aiKeys] = await Promise.all([
            getUserSettings(userId),
            getUserAiKeys(userId),
        ])

        // Analysis runs on the selected BAML client; embeddings always run
        // on Gemini. Gate each independently so a user with only a Gemini
        // key still gets embeddings.
        const analysisConfigured = isAiConfigured(settings, aiKeys)
        const geminiConfigured = !!resolveGeminiKey(aiKeys)
        if (!analysisConfigured && !geminiConfigured) {
            console.log("[AI Triggers] Skipping - AI not configured")
            return
        }

        // 1. Analysis
        if (analysisConfigured && FEATURE_FLAGS.enableAnalysis && settings.analysis.enabled && settings.analysis.autoRun) {
            console.log(`[AI Triggers] Triggering auto-analysis for link ${linkId}`)
            // Fire and forget, but log error if it fails
            analyzeLink(linkId, settings, aiKeys).then((result) => {
                if (!result.success) {
                    console.error(`[AI Triggers] Auto-analysis failed for ${linkId}:`, result.error)
                }
            })
        } else {
            console.log("[AI Triggers] Skipping analysis - disabled or autoRun off")
        }

        // 2. Embeddings
        if (geminiConfigured && settings.embeddings.enabled && settings.embeddings.autoRun) {
            console.log(`[AI Triggers] Triggering auto-embedding for link ${linkId}`)
            // Fire and forget
            generateAndStoreEmbedding(linkId, settings, "RETRIEVAL_DOCUMENT", aiKeys).then((result) => {
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
