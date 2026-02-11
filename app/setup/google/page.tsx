import Link from "next/link"
import { ArrowLeft } from "lucide-react"

function StepImage({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative mt-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800">
      <img
        src={src}
        alt={alt}
        className="w-full"
      />
      <div className="flex items-center justify-center p-8 text-sm text-zinc-400 dark:text-zinc-500">
        {alt}
      </div>
    </div>
  )
}

export default function GoogleSetupPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
            Google Cloud Setup Guide
          </h1>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:px-8">
        <p className="mb-10 text-sm text-zinc-600 dark:text-zinc-400">
          MailFeed needs a Google Cloud project with OAuth credentials (to read your Gmail) and a
          Gemini API key (for AI summaries). This guide walks you through each step.
        </p>

        <div className="space-y-12">
          {/* Step 1 */}
          <section>
            <h2 className="flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                1
              </span>
              Create a Google Cloud Project
            </h2>
            <div className="mt-3 pl-10">
              <ol className="list-inside list-decimal space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  Go to the{" "}
                  <a
                    href="https://console.cloud.google.com/projectcreate"
                    className="font-medium text-zinc-900 underline dark:text-zinc-200"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Create Project
                  </a>{" "}
                  page in Google Cloud Console.
                </li>
                <li>
                  Enter a project name (e.g.,{" "}
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                    MailFeed
                  </code>
                  ).
                </li>
                <li>Click <strong>Create</strong> and wait for it to provision.</li>
                <li>Make sure the new project is selected in the top navigation bar.</li>
              </ol>
              <StepImage
                src="/images/setup/step-1-create-project.png"
                alt="Google Cloud Console — Create Project page with project name field"
              />
            </div>
          </section>

          {/* Step 2 */}
          <section>
            <h2 className="flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                2
              </span>
              Enable the Gmail API
            </h2>
            <div className="mt-3 pl-10">
              <ol className="list-inside list-decimal space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  Open the{" "}
                  <a
                    href="https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                    className="font-medium text-zinc-900 underline dark:text-zinc-200"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Gmail API
                  </a>{" "}
                  page in the API Library.
                </li>
                <li>Click <strong>Enable</strong>.</li>
                <li>
                  Wait for the API to be enabled — you&apos;ll see a confirmation with usage metrics.
                </li>
              </ol>
              <StepImage
                src="/images/setup/step-2-enable-gmail-api.png"
                alt="Gmail API page in API Library with the Enable button highlighted"
              />
            </div>
          </section>

          {/* Step 3 */}
          <section>
            <h2 className="flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                3
              </span>
              Configure the OAuth Consent Screen
            </h2>
            <div className="mt-3 pl-10">
              <ol className="list-inside list-decimal space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  Go to{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials/consent"
                    className="font-medium text-zinc-900 underline dark:text-zinc-200"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    OAuth consent screen
                  </a>
                  .
                </li>
                <li>
                  Select <strong>External</strong> as the user type and click <strong>Create</strong>.
                </li>
                <li>
                  Fill in the required fields:
                  <ul className="mt-1 ml-5 list-disc space-y-1">
                    <li>
                      <strong>App name</strong>:{" "}
                      <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                        MailFeed
                      </code>
                    </li>
                    <li>
                      <strong>User support email</strong>: your email address
                    </li>
                    <li>
                      <strong>Developer contact</strong>: your email address
                    </li>
                  </ul>
                </li>
                <li>
                  On the <strong>Scopes</strong> step, click <strong>Add or Remove Scopes</strong> and
                  add:{" "}
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                    https://www.googleapis.com/auth/gmail.readonly
                  </code>
                </li>
                <li>
                  On the <strong>Test users</strong> step, add the Gmail address you&apos;ll use to log in.
                </li>
                <li>
                  Click <strong>Save and Continue</strong> through the remaining steps.
                </li>
              </ol>
              <StepImage
                src="/images/setup/step-3-consent-screen.png"
                alt="OAuth consent screen configuration with app name, scopes, and test users"
              />
            </div>
          </section>

          {/* Step 4 */}
          <section>
            <h2 className="flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                4
              </span>
              Create OAuth 2.0 Credentials
            </h2>
            <div className="mt-3 pl-10">
              <ol className="list-inside list-decimal space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  Go to{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    className="font-medium text-zinc-900 underline dark:text-zinc-200"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Credentials
                  </a>{" "}
                  and click <strong>Create Credentials</strong> &rarr; <strong>OAuth client ID</strong>.
                </li>
                <li>
                  Set <strong>Application type</strong> to{" "}
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                    Web application
                  </code>
                  .
                </li>
                <li>
                  Name it anything (e.g.,{" "}
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                    MailFeed Local
                  </code>
                  ).
                </li>
                <li>
                  Under <strong>Authorized redirect URIs</strong>, click <strong>Add URI</strong> and
                  enter:
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-100">
                    <code>http://localhost:3000/api/auth/callback/google</code>
                  </pre>
                </li>
                <li>Click <strong>Create</strong>.</li>
              </ol>
              <StepImage
                src="/images/setup/step-4-create-credentials.png"
                alt="Create OAuth client ID form with Web application type and redirect URI"
              />
            </div>
          </section>

          {/* Step 5 */}
          <section>
            <h2 className="flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                5
              </span>
              Copy Client ID and Client Secret
            </h2>
            <div className="mt-3 pl-10">
              <ol className="list-inside list-decimal space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  After creating the credentials, a dialog shows your <strong>Client ID</strong> and{" "}
                  <strong>Client Secret</strong>.
                </li>
                <li>
                  Copy both values into your{" "}
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                    .env
                  </code>{" "}
                  file:
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-100">
                    <code>{`GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="GOCSPX-your-client-secret"`}</code>
                  </pre>
                </li>
                <li>
                  You can also find these later under{" "}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    className="font-medium text-zinc-900 underline dark:text-zinc-200"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Credentials
                  </a>{" "}
                  by clicking the credential name.
                </li>
              </ol>
              <StepImage
                src="/images/setup/step-5-copy-credentials.png"
                alt="OAuth client created dialog showing Client ID and Client Secret values"
              />
            </div>
          </section>

          {/* Step 6 */}
          <section>
            <h2 className="flex items-center gap-3 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-zinc-200 text-sm font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                6
              </span>
              Get a Gemini API Key
            </h2>
            <div className="mt-3 pl-10">
              <ol className="list-inside list-decimal space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
                <li>
                  Go to{" "}
                  <a
                    href="https://aistudio.google.com/apikey"
                    className="font-medium text-zinc-900 underline dark:text-zinc-200"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Google AI Studio
                  </a>
                  .
                </li>
                <li>
                  Click <strong>Create API Key</strong> and select your Google Cloud project.
                </li>
                <li>
                  Copy the key into your{" "}
                  <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
                    .env
                  </code>{" "}
                  file:
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-zinc-900 px-4 py-3 text-sm text-zinc-100">
                    <code>{`GEMINI_API_KEY="your-gemini-api-key"`}</code>
                  </pre>
                </li>
              </ol>
              <StepImage
                src="/images/setup/step-6-gemini-api-key.png"
                alt="Google AI Studio API key creation page"
              />
            </div>
          </section>
        </div>

        {/* Done */}
        <div className="mt-12 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-2 text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            You&apos;re all set
          </h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            With all three values in your{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
              .env
            </code>{" "}
            file, start the app with{" "}
            <code className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs dark:bg-zinc-800">
              docker compose up
            </code>{" "}
            and open{" "}
            <a
              href="http://localhost:3000"
              className="font-medium text-zinc-900 underline dark:text-zinc-200"
            >
              http://localhost:3000
            </a>
            .
          </p>
        </div>

        {/* Footer */}
        <div className="mt-10 text-center">
          <Link
            href="/"
            className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            &larr; Back to MailFeed
          </Link>
        </div>
      </main>
    </div>
  )
}
