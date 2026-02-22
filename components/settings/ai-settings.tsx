"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { FEATURE_FLAGS } from "@/lib/flags"
import { Loader2, Bot, AlertCircle } from "lucide-react"
import { useSettings } from "@/hooks/use-settings"

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

export function AiSettings() {
  const { settings, aiKeyConfigured, requiredEnvVar, updateSettings } = useSettings()
  const [isSaving, setIsSaving] = useState(false)
  const [chatModel, setChatModel] = useState("")
  const [embeddingModel, setEmbeddingModel] = useState("")
  const [embeddingDimensions, setEmbeddingDimensions] = useState("")
  const [initialized, setInitialized] = useState(false)

  // Initialize local state from settings once loaded
  if (settings && !initialized) {
    setChatModel(settings.ai.chatModel)
    setEmbeddingModel(settings.ai.embeddingModel)
    setEmbeddingDimensions(String(settings.ai.embeddingDimensions))
    setInitialized(true)
  }

  if (!settings) return null

  const selectedClient = BAML_CLIENTS.find((c) => c.name === settings.ai.bamlClient)

  const handleClientChange = async (value: string) => {
    setIsSaving(true)
    try {
      await updateSettings({ ai: { bamlClient: value } })
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveModels = async () => {
    setIsSaving(true)
    try {
      await updateSettings({
        ai: {
          chatModel,
          embeddingModel,
          embeddingDimensions: parseInt(embeddingDimensions) || 768,
        },
      })
    } finally {
      setIsSaving(false)
    }
  }

  const hasModelChanges =
    chatModel !== settings.ai.chatModel ||
    embeddingModel !== settings.ai.embeddingModel ||
    embeddingDimensions !== String(settings.ai.embeddingDimensions)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-5 w-5" />
          AI Configuration
        </CardTitle>
        <CardDescription>
          Choose your AI provider and model settings for analysis, chat, and embeddings.
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
                Add <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900">{requiredEnvVar}</code> to
                your <code className="rounded bg-amber-100 px-1 py-0.5 text-xs dark:bg-amber-900">.env</code> file
                for the selected provider.
              </p>
            </div>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="baml-client">BAML Client (AI Provider for Analysis)</Label>
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
          <Label htmlFor="chat-model">Chat Model Name</Label>
          <Input
            id="chat-model"
            value={chatModel}
            onChange={(e) => setChatModel(e.target.value)}
            placeholder="gemini-3-pro-preview"
          />
          <p className="text-xs text-muted-foreground">
            Model used for the chat feature (Gemini API).
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="embedding-model">Embedding Model</Label>
            <Input
              id="embedding-model"
              value={embeddingModel}
              onChange={(e) => setEmbeddingModel(e.target.value)}
              placeholder="gemini-embedding-001"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="embedding-dims">Embedding Dimensions</Label>
            <Input
              id="embedding-dims"
              type="number"
              value={embeddingDimensions}
              onChange={(e) => setEmbeddingDimensions(e.target.value)}
              placeholder="768"
            />
          </div>
        </div>



        <div className="space-y-4 pt-4 border-t">
          <h3 className="font-medium">Features</h3>

          <div className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-4">
              {FEATURE_FLAGS.enableAnalysis && (
                <>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor="analysis-enabled">Content Analysis</Label>
                      <p className="text-xs text-muted-foreground">
                        Extract summaries and tags
                      </p>
                    </div>
                    <Switch
                      id="analysis-enabled"
                      checked={settings.analysis.enabled}
                      onCheckedChange={(checked) =>
                        updateSettings({ analysis: { ...settings.analysis, enabled: checked } })
                      }
                      disabled={isSaving}
                    />
                  </div>

                  {settings.analysis.enabled && (
                    <div className="flex items-center justify-between pl-2 border-l-2">
                      <div className="space-y-0.5">
                        <Label htmlFor="analysis-autorun">Auto-Analyze</Label>
                        <p className="text-xs text-muted-foreground">
                          Run automatically on new links
                        </p>
                      </div>
                      <Switch
                        id="analysis-autorun"
                        checked={settings.analysis.autoRun}
                        onCheckedChange={(checked) =>
                          updateSettings({ analysis: { ...settings.analysis, autoRun: checked } })
                        }
                        disabled={isSaving}
                      />
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label htmlFor="embeddings-enabled">Vector Embeddings</Label>
                  <p className="text-xs text-muted-foreground">
                    Enable semantic search (RAG)
                  </p>
                </div>
                <Switch
                  id="embeddings-enabled"
                  checked={settings.embeddings.enabled}
                  onCheckedChange={(checked) =>
                    updateSettings({ embeddings: { ...settings.embeddings, enabled: checked } })
                  }
                  disabled={isSaving}
                />
              </div>

              {settings.embeddings.enabled && (
                <div className="flex items-center justify-between pl-2 border-l-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="embeddings-autorun">Auto-Embed</Label>
                    <p className="text-xs text-muted-foreground">
                      Run automatically on new links
                    </p>
                  </div>
                  <Switch
                    id="embeddings-autorun"
                    checked={settings.embeddings.autoRun}
                    onCheckedChange={(checked) =>
                      updateSettings({ embeddings: { ...settings.embeddings, autoRun: checked } })
                    }
                    disabled={isSaving}
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {
          hasModelChanges && (
            <Button onClick={handleSaveModels} disabled={isSaving} size="sm">
              {isSaving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Model Settings"
              )}
            </Button>
          )
        }
      </CardContent >
    </Card >
  )
}
