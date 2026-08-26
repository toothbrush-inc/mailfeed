/** Client-safe copy for a missing AI key. Mirrors missingGeminiKeyMessage on the server. */
export function missingAiKeyHint(encryptionEnabled: boolean | undefined, envVar: string): string {
  if (encryptionEnabled === false) {
    return `Set ${envVar} in your .env file.`
  }
  if (envVar === "GEMINI_API_KEY") {
    return "Add your Gemini key in Settings → AI, or set GEMINI_API_KEY on the server."
  }
  return `Set ${envVar} on the server, or switch to Google Gemini in Settings → AI to use your own key.`
}
