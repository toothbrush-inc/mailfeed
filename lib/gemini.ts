import { GoogleGenAI } from "@google/genai"

const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! })

export interface AnalysisResult {
  summary: string
  keyPoints: string[]
  category: string
  tags: string[]
  worthinessScore: number
  uniquenessScore: number
  isHighlighted: boolean
  highlightReason?: string
}

const ANALYSIS_PROMPT = `You are a content analyst for a personal reading feed. Analyze the following article and provide structured feedback.

ARTICLE TITLE: {title}
ARTICLE CONTENT:
{content}

Provide your analysis in the following JSON format:
{
  "summary": "A 2-3 sentence summary capturing the main idea and value proposition of the article",
  "keyPoints": ["Key point 1", "Key point 2", "Key point 3"],
  "category": "One of: Technology, Business, Science, Health, Politics, Culture, Finance, Self-Improvement, News, Opinion, Tutorial, Research",
  "tags": ["tag1", "tag2", "tag3", "tag4", "tag5"],
  "worthinessScore": 0.0-1.0,
  "uniquenessScore": 0.0-1.0,
  "isHighlighted": true/false,
  "highlightReason": "If highlighted, explain why in one sentence"
}

Scoring Guidelines:
- worthinessScore (0.0-1.0): How valuable/worth reading is this content? Consider: depth, originality, actionable insights, quality of writing
- uniquenessScore (0.0-1.0): How novel/different is this perspective? Consider: unique insights, contrarian views, fresh angles
- isHighlighted: Should this be highlighted as particularly noteworthy? Only true for exceptional content
- keyPoints: The 3 most actionable or memorable takeaways
- tags: Specific and useful for filtering (avoid generic tags like "article" or "interesting")
- category: Pick the single most appropriate category

Return ONLY valid JSON, no markdown formatting or additional text.`

export async function analyzeContent(
  title: string,
  content: string
): Promise<AnalysisResult> {
  // Truncate content to avoid token limits (~15000 chars for safety)
  const truncatedContent =
    content.length > 15000 ? content.slice(0, 15000) + "..." : content

  const prompt = ANALYSIS_PROMPT.replace("{title}", title).replace(
    "{content}",
    truncatedContent
  )

  // Log the input
  console.log("\n" + "=".repeat(80))
  console.log("[Gemini] Analyzing article:", title)
  console.log("[Gemini] Content length:", content.length, "chars (truncated:", truncatedContent.length, "chars)")
  console.log("[Gemini] Prompt preview:", prompt.slice(0, 500) + "...")
  console.log("=".repeat(80))

  const startTime = Date.now()

  const response = await genAI.models.generateContent({
    model: "gemini-1.5-flash",
    contents: prompt,
  })

  const elapsed = Date.now() - startTime
  const text = response.text || ""

  // Log the raw response
  console.log("\n" + "-".repeat(80))
  console.log("[Gemini] Response received in", elapsed, "ms")
  console.log("[Gemini] Raw response:", text)
  console.log("-".repeat(80))

  try {
    // Clean potential markdown code blocks
    const cleanJson = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim()

    const parsed = JSON.parse(cleanJson) as AnalysisResult

    // Validate and sanitize the response
    const result = {
      summary: parsed.summary || "No summary available",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 5) : [],
      category: parsed.category || "Uncategorized",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
      worthinessScore: Math.min(1, Math.max(0, parsed.worthinessScore || 0.5)),
      uniquenessScore: Math.min(1, Math.max(0, parsed.uniquenessScore || 0.5)),
      isHighlighted: Boolean(parsed.isHighlighted),
      highlightReason: parsed.highlightReason || undefined,
    }

    // Log the parsed result
    console.log("[Gemini] Parsed result:", JSON.stringify(result, null, 2))
    console.log("=".repeat(80) + "\n")

    return result
  } catch (error) {
    console.error("[Gemini] Failed to parse response:", text)
    console.error("[Gemini] Parse error:", error)
    throw new Error("Failed to parse AI analysis response")
  }
}

export async function batchAnalyze(
  articles: Array<{ id: string; title: string; content: string }>
): Promise<Map<string, AnalysisResult>> {
  const results = new Map<string, AnalysisResult>()

  console.log("\n" + "#".repeat(80))
  console.log("[Gemini Batch] Starting batch analysis of", articles.length, "articles")
  console.log("#".repeat(80))

  // Process in batches of 3 to respect rate limits
  const batchSize = 3
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(articles.length / batchSize)

    console.log(`\n[Gemini Batch] Processing batch ${batchNum}/${totalBatches} (${batch.length} articles)`)

    const promises = batch.map(async (article) => {
      try {
        const analysis = await analyzeContent(article.title, article.content)
        results.set(article.id, analysis)
        console.log(`[Gemini Batch] ✓ Completed: ${article.title.slice(0, 50)}...`)
      } catch (error) {
        console.error(`[Gemini Batch] ✗ Failed: ${article.id}`, error)
      }
    })

    await Promise.all(promises)

    // Rate limiting: wait 1 second between batches
    if (i + batchSize < articles.length) {
      console.log("[Gemini Batch] Rate limiting: waiting 1s before next batch...")
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  console.log("\n" + "#".repeat(80))
  console.log("[Gemini Batch] Completed:", results.size, "/", articles.length, "articles analyzed successfully")
  console.log("#".repeat(80) + "\n")

  return results
}
