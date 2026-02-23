"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import {
  Mail,
  LinkIcon,
  Sparkles,
  FileText,
  Search,
  LayoutList,
  CircleCheck,
  CircleX,
  TriangleAlert,
  Terminal,
  Code,
} from "lucide-react"
import type { SetupCheck } from "@/app/page"

const features = [
  {
    icon: Mail,
    title: "Gmail Integration",
    description:
      "Syncs emails you send to yourself. Just email yourself a link and MailFeed picks it up.",
  },
  {
    icon: LinkIcon,
    title: "Smart Link Extraction",
    description:
      "Automatically finds, deduplicates, and follows redirects to surface the real URLs.",
  },
  {
    icon: FileText,
    title: "Content Fetching",
    description:
      "Fetches full articles with Mozilla Readability. Detects paywalls and falls back to archives.",
  },
  {
    icon: LayoutList,
    title: "Reading Feed",
    description:
      "Clean, organized feed with filters, search, categories, and reading time estimates.",
  },
  {
    icon: Search,
    title: "Semantic Search",
    description:
      "Chat with your saved links using vector embeddings and RAG-powered search.",
  },
  {
    icon: Sparkles,
    title: "AI Summaries",
    description:
      "AI-powered summaries, key points, categorization, and worthiness scores for every link.",
    comingSoon: true,
  },
]

const steps = [
  {
    label: "Clone the repository",
    why: "Get the source code on your machine",
    code: "git clone https://github.com/davidd8/mailfeed.git\ncd mailfeed",
  },
  {
    label: "Copy the environment template",
    why: "Configure your Google API credentials",
    code: "cp .env.example .env",
  },
  {
    label: "Start everything with Docker Compose",
    why: "Builds and runs the app + database",
    code: "docker compose up",
  },
  {
    label: "Open your browser",
    why: "Start using MailFeed",
    code: "http://localhost:3000",
  },
]

export function LandingPage({ setupChecks }: { setupChecks?: SetupCheck[] }) {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Setup Banner */}
      {setupChecks && (
        <div className="border-b border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950">
          <div className="mx-auto max-w-3xl px-4 py-5 sm:px-6 lg:px-8">
            <div className="mb-3 flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
                Setup Required
              </h2>
            </div>
            <p className="mb-4 text-sm text-amber-800 dark:text-amber-200">
              Add the following environment variables to your{" "}
              <code className="rounded bg-amber-100 px-1.5 py-0.5 text-xs dark:bg-amber-900">
                .env
              </code>{" "}
              file, then restart the app.
            </p>
            <ul className="space-y-2">
              {setupChecks.map((check) => (
                <li key={check.key} className="flex items-start gap-2 text-sm">
                  {check.ok ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-400" />
                  ) : check.optional ? (
                    <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
                  ) : (
                    <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" />
                  )}
                  <div>
                    <code className="font-semibold text-amber-900 dark:text-amber-100">
                      {check.label}
                    </code>
                    {!check.ok && (
                      <span className="ml-2 text-amber-700 dark:text-amber-300">
                        &mdash;{" "}
                        {check.url ? (
                          <a
                            href={check.url}
                            className="underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {check.hint}
                          </a>
                        ) : (
                          check.hint
                        )}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Hero */}
      <section className="flex flex-col items-center justify-center px-4 pt-24 pb-16 text-center sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-bold tracking-tight text-zinc-900 sm:text-5xl lg:text-6xl dark:text-zinc-50">
            MailFeed
          </h1>
          <p className="mt-4 text-lg text-zinc-600 sm:text-xl dark:text-zinc-400">
            Turn your emails into a personalized reading feed with
            full-text content, semantic search, and smart link extraction.
          </p>
          <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-500">
            Email yourself a link. MailFeed does the rest.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg">
              <Link href="/login">Get Started</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="#install">Self-Host</a>
            </Button>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="mb-10 text-center text-2xl font-bold text-zinc-900 dark:text-zinc-50">
          Features
        </h2>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className={`rounded-lg border p-6 ${
                feature.comingSoon
                  ? "border-dashed border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900/50"
                  : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
              }`}
            >
              <div className="mb-3 flex items-center gap-2">
                <feature.icon className={`h-6 w-6 ${feature.comingSoon ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-300"}`} />
                {feature.comingSoon && (
                  <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
                    Coming Soon
                  </span>
                )}
              </div>
              <h3 className={`mb-1 font-semibold ${feature.comingSoon ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-900 dark:text-zinc-50"}`}>
                {feature.title}
              </h3>
              <p className={`text-sm ${feature.comingSoon ? "text-zinc-400 dark:text-zinc-500" : "text-zinc-600 dark:text-zinc-400"}`}>
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Install */}
      <InstallSection />

      {/* Footer */}
      <footer className="border-t border-zinc-200 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
        <p>
          MailFeed — built with Next.js, Prisma, and Gemini.{" "}
          <a
            href="https://github.com/davidd8/mailfeed"
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            View on GitHub
          </a>
        </p>
      </footer>
    </div>
  )
}

function InstallSection() {
  const [activeTab, setActiveTab] = useState<"quick" | "dev">("quick")

  return (
    <section
      id="install"
      className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8"
    >
      <h2 className="mb-2 text-center text-2xl font-bold text-zinc-900 dark:text-zinc-50">
        Self-Host MailFeed
      </h2>
      <p className="mb-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
        Run it on your own machine. Your data stays with you.
      </p>

      {/* Tab Switcher */}
      <div className="mb-6 flex justify-center">
        <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-1 dark:border-zinc-800 dark:bg-zinc-900">
          <button
            onClick={() => setActiveTab("quick")}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "quick"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            <Terminal className="h-4 w-4" />
            Quick Start
          </button>
          <button
            onClick={() => setActiveTab("dev")}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === "dev"
                ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-zinc-50"
                : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
            }`}
          >
            <Code className="h-4 w-4" />
            Developer Setup
          </button>
        </div>
      </div>

      {activeTab === "quick" ? <QuickStartPath /> : <DevSetupPath />}
    </section>
  )
}

function QuickStartPath() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">
          Run this single command in Terminal. It installs Docker, clones the
          repo, and walks you through entering your API keys.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-100">
          <code>curl -fsSL https://raw.githubusercontent.com/davidd8/mailfeed/main/scripts/setup.sh | bash</code>
        </pre>
        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
          macOS only. Requires an internet connection. The script will prompt you
          for Google API credentials.
        </p>
      </div>

      <details className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <summary className="cursor-pointer px-5 py-4 text-sm font-semibold text-zinc-900 select-none dark:text-zinc-50">
          Details &amp; prerequisites
        </summary>
        <div className="space-y-5 border-t border-zinc-100 px-5 pt-4 pb-5 dark:border-zinc-800">
          <div>
            <h4 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              What the script does
            </h4>
            <ol className="list-inside list-decimal space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <li>Checks for (or installs) Homebrew, Docker Desktop, and Git</li>
              <li>
                Clones MailFeed into{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                  ~/mailfeed
                </code>
              </li>
              <li>
                Creates{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                  .env
                </code>{" "}
                and generates a secure secret
              </li>
              <li>Prompts you for Google OAuth credentials (and optionally a Gemini API key)</li>
              <li>
                Starts the app with Docker Compose at{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                  http://localhost:3000
                </code>
              </li>
            </ol>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Google Cloud setup
            </h4>
            <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
              The script will ask for your Google credentials (the Gemini key is optional). Follow our{" "}
              <Link
                href="/setup/google"
                className="font-medium text-zinc-900 underline dark:text-zinc-200"
              >
                step-by-step guide
              </Link>{" "}
              for detailed instructions with screenshots, or use the quick links below:
            </p>
            <ol className="list-inside list-decimal space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <li>
                <a
                  href="https://console.cloud.google.com/projectcreate"
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Create a project
                </a>{" "}
                in Google Cloud Console
              </li>
              <li>
                Enable the{" "}
                <a
                  href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Gmail API
                </a>
              </li>
              <li>
                <a
                  href="https://console.cloud.google.com/apis/credentials/oauthclient"
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Create OAuth 2.0 credentials
                </a>{" "}
                (Web application) with redirect URI:{" "}
                <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                  http://localhost:3000/api/auth/callback/google
                </code>
              </li>
              <li>
                <span className="text-zinc-400 dark:text-zinc-500">(Optional)</span>{" "}
                Get a Gemini API key from{" "}
                <a
                  href="https://aistudio.google.com/apikey"
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google AI Studio
                </a>{" "}
                — enables AI semantic search
              </li>
            </ol>
          </div>
        </div>
      </details>
    </div>
  )
}

function DevSetupPath() {
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h3 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
          Before you start
        </h3>
        <ul className="space-y-1 text-sm text-zinc-600 dark:text-zinc-400">
          <li>
            <a
              href="https://docs.docker.com/get-docker/"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Docker
            </a>{" "}
            installed and running
          </li>
          <li>
            A{" "}
            <a
              href="https://console.cloud.google.com/"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google Cloud
            </a>{" "}
            project with OAuth credentials and Gmail API enabled
          </li>
          <li>
            <span className="text-zinc-400 dark:text-zinc-500">(Optional)</span>{" "}
            A{" "}
            <a
              href="https://aistudio.google.com/apikey"
              className="underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Gemini API key
            </a>{" "}
            — for AI semantic search
          </li>
        </ul>
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Need help with credentials? Follow our{" "}
          <Link
            href="/setup/google"
            className="font-medium text-zinc-900 underline dark:text-zinc-200"
          >
            step-by-step Google Cloud guide
          </Link>
          .
        </p>
      </div>

      <ol className="space-y-4">
        {steps.map((step, i) => (
          <li
            key={i}
            className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <p className="mb-1 text-sm font-medium text-zinc-900 dark:text-zinc-50">
              <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 text-xs font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                {i + 1}
              </span>
              {step.label}
            </p>
            <p className="mb-3 pl-7 text-xs text-zinc-500 dark:text-zinc-400">
              {step.why}
            </p>
            <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm text-zinc-100">
              <code>{step.code}</code>
            </pre>
          </li>
        ))}
      </ol>
    </div>
  )
}
