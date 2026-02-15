import type { ResolvedSettings } from "@/lib/settings"

export const BAML_CLIENTS = [
  { name: "CustomGemini", label: "Google Gemini", envVar: "GEMINI_API_KEY" },
  { name: "CustomGPT5", label: "OpenAI GPT-5", envVar: "OPENAI_API_KEY" },
  { name: "CustomGPT5Mini", label: "OpenAI GPT-5 Mini", envVar: "OPENAI_API_KEY" },
  { name: "CustomGPT5Chat", label: "OpenAI GPT-5 (Chat)", envVar: "OPENAI_API_KEY" },
  { name: "CustomOpus4", label: "Anthropic Claude Opus 4", envVar: "ANTHROPIC_API_KEY" },
  { name: "CustomSonnet4", label: "Anthropic Claude Sonnet 4", envVar: "ANTHROPIC_API_KEY" },
  { name: "CustomHaiku", label: "Anthropic Claude Haiku", envVar: "ANTHROPIC_API_KEY" },
  { name: "CustomFast", label: "Round-Robin (GPT-5 Mini + Haiku)", envVar: "OPENAI_API_KEY" },
  { name: "OpenaiFallback", label: "Fallback (GPT-5 Mini → GPT-5)", envVar: "OPENAI_API_KEY" },
] as const

const CLIENT_ENV_MAP: Record<string, string> = Object.fromEntries(
  BAML_CLIENTS.map((c) => [c.name, c.envVar])
)

export function getRequiredApiKeyEnvVar(bamlClient: string): string {
  return CLIENT_ENV_MAP[bamlClient] || "GEMINI_API_KEY"
}

export function isAiConfigured(settings: ResolvedSettings): boolean {
  const envVar = getRequiredApiKeyEnvVar(settings.ai.bamlClient)
  return !!process.env[envVar]
}

export function getMissingEnvVarMessage(settings: ResolvedSettings): string {
  const envVar = getRequiredApiKeyEnvVar(settings.ai.bamlClient)
  return `${envVar} is not configured. Add it to your .env file to enable AI features.`
}
