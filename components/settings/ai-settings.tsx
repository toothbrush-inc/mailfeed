"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Bot, AlertCircle, KeyRound } from "lucide-react"
import { useSettings, type AiKeyName } from "@/hooks/use-settings"
import { missingAiKeyHint } from "@/lib/ai-key-hint"

const BAML_CLIENTS = [
  { name: "CustomGemini", label: "Google Gemini", envVar: "GEMINI_API_KEY" },
  { name: "CustomGPT5", label: "OpenAI GPT-5", envVar: "OPENAI_API_KEY" },
  { name: "CustomGPT5Mini", label: "OpenAI GPT-5 Mini", envVar: "OPENAI_API_KEY" },
  { name: "CustomGPT5Chat", label: "OpenAI GPT-5 (Chat)", envVar: "OPENAI_API_KEY" },
  { name: "CustomOpus4", label: "Anthropic Claude Opus 4", envVar: "ANTHROPIC_API_KEY" },
  { name: "CustomSonnet4", label: "Anthropic Claude Sonnet 4", envVar: "ANTHROPIC_API_KEY" },
  { name: "CustomHaiku", label: "Anthropic Claude Haiku", envVar: "ANTHROPIC_API_KEY" },
  { name: "CustomFast", label: "Round-Robin (GPT-5 Mini + Haiku)", envVar: "OPENAI_API_KEY" },
  { name: "OpenaiFallback", label: "Fallback (GPT-5 Mini → GPT-5)", envVar: "OPENAI_API_KEY" },
]

// Chat model options grouped by BAML client
const CHAT_MODELS_BY_CLIENT: Record<string, Array<{ value: string; label: string }>> = {
  CustomGemini: [
    { value: "gemini-3.7-flash", label: "Gemini 3.7 Flash" },
    { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
  ],
  CustomGPT5: [
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-5-mini", label: "GPT-5 Mini" },
  ],
  CustomGPT5Mini: [
    { value: "gpt-5-mini", label: "GPT-5 Mini" },
    { value: "gpt-5", label: "GPT-5" },
  ],
  CustomGPT5Chat: [
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-5-mini", label: "GPT-5 Mini" },
  ],
  CustomOpus4: [
    { value: "claude-opus-4-1-20250805", label: "Claude Opus 4" },
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-3-5-haiku-20241022", label: "Claude Haiku 3.5" },
  ],
  CustomSonnet4: [
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-1-20250805", label: "Claude Opus 4" },
    { value: "claude-3-5-haiku-20241022", label: "Claude Haiku 3.5" },
  ],
  CustomHaiku: [
    { value: "claude-3-5-haiku-20241022", label: "Claude Haiku 3.5" },
    { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
    { value: "claude-opus-4-1-20250805", label: "Claude Opus 4" },
  ],
  CustomFast: [
    { value: "gpt-5-mini", label: "GPT-5 Mini" },
    { value: "gpt-5", label: "GPT-5" },
  ],
  OpenaiFallback: [
    { value: "gpt-5-mini", label: "GPT-5 Mini" },
    { value: "gpt-5", label: "GPT-5" },
  ],
}

// Gemini only for now: chat and semantic search run on Gemini regardless of
// the selected analysis client, so one key unlocks every feature.
const API_KEY_PROVIDERS: Array<{ name: AiKeyName; label: string; envVar: string }> = [
  { name: "gemini", label: "Google Gemini", envVar: "GEMINI_API_KEY" },
]

function ApiKeyRow({
  provider,
  savedMask,
  onSave,
  onClear,
}: {
  provider: { name: AiKeyName; label: string; envVar: string }
  savedMask?: string
  onSave: (value: string) => Promise<void>
  onClear: () => Promise<void>
}) {
  const [value, setValue] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setValue("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update API key")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-1">
      <Label htmlFor={`key-${provider.name}`}>{provider.label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={`key-${provider.name}`}
          type="password"
          autoComplete="off"
          placeholder={savedMask ? `Saved (${savedMask})` : "Not set — using the host's key if available"}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={busy}
        />
        <Button
          size="sm"
          disabled={busy || value.trim() === ""}
          onClick={() => run(() => onSave(value.trim()))}
        >
          Save
        </Button>
        {savedMask && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(onClear)}>
            Clear
          </Button>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function AiSettings() {
  const { settings, aiKeyConfigured, requiredEnvVar, aiKeys, encryptionEnabled, updateApiKeys, updateSettings } = useSettings()
  const [isSaving, setIsSaving] = useState(false)

  if (!settings) return null

  const selectedClient = BAML_CLIENTS.find((c) => c.name === settings.ai.bamlClient)
  const chatModels = CHAT_MODELS_BY_CLIENT[settings.ai.bamlClient] || []
  // If current chatModel isn't in the list for this platform, show it but let user switch
  const chatModelInList = chatModels.some((m) => m.value === settings.ai.chatModel)

  const handleClientChange = async (value: string) => {
    setIsSaving(true)
    try {
      // When switching platform, also set chat model to the first option for that platform
      const newModels = CHAT_MODELS_BY_CLIENT[value] || []
      const newChatModel = newModels[0]?.value ?? settings.ai.chatModel
      await updateSettings({ ai: { bamlClient: value, chatModel: newChatModel } })
    } finally {
      setIsSaving(false)
    }
  }

  const handleChatModelChange = async (value: string) => {
    setIsSaving(true)
    try {
      await updateSettings({ ai: { chatModel: value } })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Configuration
        </CardTitle>
        <CardDescription>
          Choose your AI platform and chat model.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!aiKeyConfigured && (
          <div className="flex items-start gap-3 rounded-md bg-amber-50 p-4 dark:bg-amber-950">
            <AlertCircle className="h-5 w-5 mt-0.5 text-amber-500 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                API Key Missing
              </p>
              <p className="text-sm text-amber-600 dark:text-amber-400">
                {missingAiKeyHint(encryptionEnabled, requiredEnvVar || "GEMINI_API_KEY")}
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="baml-client">AI Platform</Label>
          <Select value={settings.ai.bamlClient} onValueChange={handleClientChange} disabled={isSaving}>
            <SelectTrigger id="baml-client">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BAML_CLIENTS.map((client) => (
                <SelectItem key={client.name} value={client.name}>
                  {client.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedClient && (
            <p className="text-xs text-muted-foreground">
              Requires <code className="rounded bg-muted px-1 py-0.5 text-xs">{selectedClient.envVar}</code>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="chat-model">Chat Model</Label>
          <Select value={settings.ai.chatModel} onValueChange={handleChatModelChange} disabled={isSaving}>
            <SelectTrigger id="chat-model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {!chatModelInList && (
                <SelectItem value={settings.ai.chatModel}>
                  {settings.ai.chatModel}
                </SelectItem>
              )}
              {chatModels.map((model) => (
                <SelectItem key={model.value} value={model.value}>
                  {model.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Model used for the chat feature.
          </p>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            <Label>Your API Keys</Label>
          </div>
          <p className="text-xs text-muted-foreground">
            Your Gemini key powers chat, semantic search, and embeddings for your
            account. It is stored encrypted with your account key and used only for
            your own requests. Get one at aistudio.google.com/apikey.
          </p>
          {encryptionEnabled === false && (
            <p className="text-xs text-muted-foreground">
              Per-user keys need encryption at rest, which this instance has not
              configured (<code className="rounded bg-muted px-1 py-0.5">MAILFEED_KEK</code>).
              Self-hosted single-user setups can keep using the server&apos;s env keys.
            </p>
          )}
          {encryptionEnabled !== false && API_KEY_PROVIDERS.map((provider) => (
            <ApiKeyRow
              key={provider.name}
              provider={provider}
              savedMask={aiKeys?.[provider.name]}
              onSave={(value) => updateApiKeys({ [provider.name]: value }).then(() => undefined)}
              onClear={() => updateApiKeys({ [provider.name]: null }).then(() => undefined)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
