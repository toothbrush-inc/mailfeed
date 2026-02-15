"use client"

import useSWR from "swr"
import type { ResolvedSettings, UserSettings } from "@/lib/settings"

interface SettingsResponse {
  settings: ResolvedSettings
  aiKeyConfigured: boolean
  requiredEnvVar: string
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

  return {
    settings: data?.settings,
    aiKeyConfigured: data?.aiKeyConfigured,
    requiredEnvVar: data?.requiredEnvVar,
    isLoading,
    error,
    mutate,
    updateSettings,
  }
}
