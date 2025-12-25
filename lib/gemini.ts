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

  const response = await genAI.models.generateContent({
    model: "gemini-1.5-flash",
    contents: prompt,
  })

  const text = response.text || ""

  try {
    // Clean potential markdown code blocks
    const cleanJson = text
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim()

    const parsed = JSON.parse(cleanJson) as AnalysisResult

    // Validate and sanitize the response
    return {
      summary: parsed.summary || "No summary available",
      keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 5) : [],
      category: parsed.category || "Uncategorized",
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
      worthinessScore: Math.min(1, Math.max(0, parsed.worthinessScore || 0.5)),
      uniquenessScore: Math.min(1, Math.max(0, parsed.uniquenessScore || 0.5)),
      isHighlighted: Boolean(parsed.isHighlighted),
      highlightReason: parsed.highlightReason || undefined,
    }
  } catch {
    console.error("Failed to parse Gemini response:", text)
    throw new Error("Failed to parse AI analysis response")
  }
}

export async function batchAnalyze(
  articles: Array<{ id: string; title: string; content: string }>
): Promise<Map<string, AnalysisResult>> {
  const results = new Map<string, AnalysisResult>()

  // Process in batches of 3 to respect rate limits
  const batchSize = 3
  for (let i = 0; i < articles.length; i += batchSize) {
    const batch = articles.slice(i, i + batchSize)

    const promises = batch.map(async (article) => {
      try {
        const analysis = await analyzeContent(article.title, article.content)
        results.set(article.id, analysis)
      } catch (error) {
        console.error(`Failed to analyze article ${article.id}:`, error)
      }
    })

    await Promise.all(promises)

    // Rate limiting: wait 1 second between batches
    if (i + batchSize < articles.length) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  return results
}
