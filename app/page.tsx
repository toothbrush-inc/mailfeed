import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { LandingPage } from "@/components/landing/landing-page"

export type SetupCheck = {
  key: string
  label: string
  hint: string
  url?: string
  ok: boolean
}

function isSet(value: string | undefined): boolean {
  return !!value && value !== "null" && value !== "undefined" && value.trim() !== ""
}

function getSetupChecks(): SetupCheck[] {
  return [
    {
      key: "secret",
      label: "NEXTAUTH_SECRET",
      hint: "Generate one with: openssl rand -base64 32",
      ok: isSet(process.env.NEXTAUTH_SECRET) || isSet(process.env.AUTH_SECRET),
    },
    {
      key: "google_id",
      label: "GOOGLE_CLIENT_ID",
      hint: "Create OAuth 2.0 credentials in Google Cloud Console",
      url: "https://console.cloud.google.com/apis/credentials",
      ok: isSet(process.env.GOOGLE_CLIENT_ID),
    },
    {
      key: "google_secret",
      label: "GOOGLE_CLIENT_SECRET",
      hint: "From the same OAuth 2.0 credentials",
      url: "https://console.cloud.google.com/apis/credentials",
      ok: isSet(process.env.GOOGLE_CLIENT_SECRET),
    },
    {
      key: "gemini",
      label: "GEMINI_API_KEY",
      hint: "Get one from Google AI Studio",
      url: "https://aistudio.google.com/apikey",
      ok: isSet(process.env.GEMINI_API_KEY),
    },
  ]
}

export default async function HomePage() {
  const session = await auth()

  if (session) {
    redirect("/feed")
  }

  const setupChecks = getSetupChecks()
  const hasSetupIssues = setupChecks.some((c) => !c.ok)

  return <LandingPage setupChecks={hasSetupIssues ? setupChecks : undefined} />
}
