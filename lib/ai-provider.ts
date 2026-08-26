import type { ResolvedSettings } from "@/lib/settings"
import { encryptionConfigured } from "@/lib/crypto/kek"
import { missingGeminiKeyMessage, resolveApiKey, type AiKeys } from "@/lib/user-keys"

// provider/model mirror baml_src/clients.baml so a per-user key can
// re-register the same client name with an explicit api_key (BYOK).
// CustomFast and OpenaiFallback are strategy clients composed of the leaf
// clients below; they carry no provider/model of their own.
export const BAML_CLIENTS = [
  { name: "CustomGemini", label: "Google Gemini", envVar: "GEMINI_API_KEY", provider: "google-ai", model: "gemini-3-pro-preview" },
  { name: "CustomGPT5", label: "OpenAI GPT-5", envVar: "OPENAI_API_KEY", provider: "openai-responses", model: "gpt-5" },
  { name: "CustomGPT5Mini", label: "OpenAI GPT-5 Mini", envVar: "OPENAI_API_KEY", provider: "openai-responses", model: "gpt-5-mini" },
  { name: "CustomGPT5Chat", label: "OpenAI GPT-5 (Chat)", envVar: "OPENAI_API_KEY", provider: "openai", model: "gpt-5" },
  { name: "CustomOpus4", label: "Anthropic Claude Opus 4", envVar: "ANTHROPIC_API_KEY", provider: "anthropic", model: "claude-opus-4-1-20250805" },
  { name: "CustomSonnet4", label: "Anthropic Claude Sonnet 4", envVar: "ANTHROPIC_API_KEY", provider: "anthropic", model: "claude-sonnet-4-20250514" },
  { name: "CustomHaiku", label: "Anthropic Claude Haiku", envVar: "ANTHROPIC_API_KEY", provider: "anthropic", model: "claude-3-5-haiku-20241022" },
  { name: "CustomFast", label: "Round-Robin (GPT-5 Mini + Haiku)", envVar: "OPENAI_API_KEY", provider: null, model: null },
  { name: "OpenaiFallback", label: "Fallback (GPT-5 Mini → GPT-5)", envVar: "OPENAI_API_KEY", provider: null, model: null },
] as const

const CLIENT_ENV_MAP: Record<string, string> = Object.fromEntries(
  BAML_CLIENTS.map((c) => [c.name, c.envVar])
)

export function getRequiredApiKeyEnvVar(bamlClient: string): string {
  return CLIENT_ENV_MAP[bamlClient] || "GEMINI_API_KEY"
}

export function isAiConfigured(settings: ResolvedSettings, keys?: AiKeys): boolean {
  const envVar = getRequiredApiKeyEnvVar(settings.ai.bamlClient)
  return !!resolveApiKey(keys, envVar)
}

export function getMissingEnvVarMessage(settings: ResolvedSettings): string {
  const envVar = getRequiredApiKeyEnvVar(settings.ai.bamlClient)
  if (envVar === "GEMINI_API_KEY") {
    return missingGeminiKeyMessage()
  }
  if (encryptionConfigured()) {
    return `No API key for this model (${envVar} is not set on the server). Switch to Google Gemini in Settings → AI to use your own key.`
  }
  return `${envVar} is not configured. Add it to your .env file to enable AI features.`
}
