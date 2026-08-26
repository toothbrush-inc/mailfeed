"use client"

import useSWR from "swr"
import type { ResolvedSettings, UserSettings } from "@/lib/settings"

// Gemini only for now — widen when more BYOK providers are supported.
export type AiKeyName = "gemini"

interface SettingsResponse {
  settings: ResolvedSettings
  aiKeyConfigured: boolean
  requiredEnvVar: string
  // Masked (last 4 only) — the server never returns live keys.
  aiKeys?: Partial<Record<AiKeyName, string>>
  encryptionEnabled?: boolean
}

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export function useSettings() {
  const { data, error, isLoading, mutate } = useSWR<SettingsResponse>(
    "/api/settings",
    fetcher
  )

  const updateSettings = async (partial: UserSettings) => {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    })

    if (!response.ok) {
      throw new Error("Failed to update settings")
    }

    const updated = await response.json()
    mutate(updated, false)
    return updated as SettingsResponse
  }

  const updateApiKeys = async (apiKeys: Partial<Record<AiKeyName, string | null>>) => {
    const response = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKeys }),
    })

    if (!response.ok) {
      let detail = "Failed to update API keys"
      try {
        const body = await response.json()
        if (typeof body?.error === "string" && body.error.trim()) detail = body.error
      } catch {
        // Keep the generic fallback when the body isn't JSON.
      }
      throw new Error(detail)
    }

    const updated = await response.json()
    mutate(updated, false)
    return updated as SettingsResponse
  }

  return {
    settings: data?.settings,
    aiKeyConfigured: data?.aiKeyConfigured,
    requiredEnvVar: data?.requiredEnvVar,
    aiKeys: data?.aiKeys,
    encryptionEnabled: data?.encryptionEnabled,
    updateApiKeys,
    isLoading,
    error,
    mutate,
    updateSettings,
  }
}
