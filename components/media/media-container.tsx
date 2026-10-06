"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import {
  BookOpen,
  ExternalLink,
  Eye,
  Gamepad2,
  Heart,
  Loader2,
  Podcast,
  ScanSearch,
  Search,
  Sparkles,
  Video,
  type LucideIcon,
} from "lucide-react"
import { useMedia, useMediaRescan, useLookups, type MediaItem } from "@/hooks/use-media"
import { MEDIA_TYPES, isMediaType, type MediaType } from "@/lib/media"
import { LinkSearch } from "@/components/feed/link-search"
import { Pagination } from "@/components/feed/pagination"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

const TYPE_INFO: Record<MediaType, { label: string; singular: string; icon: LucideIcon }> = {
  video: { label: "Videos", singular: "Video", icon: Video },
  podcast: { label: "Podcasts", singular: "Podcast", icon: Podcast },
  book: { label: "Books", singular: "Book", icon: BookOpen },
  game: { label: "Games", singular: "Game", icon: Gamepad2 },
}

const SCAN_HELP =
  "Looks through posts you already synced for videos and other links that weren't kept at the time, including links in quoted posts, fills in missing video titles, and removes tracking parameters from saved addresses. No AI is used. New posts are covered automatically."

function formatDate(dateString: string): string {
  const date = new Date(dateString)
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  })
}

function displayDomain(domain: string | null): string | null {
  return domain ? domain.replace(/^www\./, "") : null
}

const LOOKUP_HELP =
  "Looks for what a saved post or page points at without linking it: the public video behind an uploaded clip, the podcast episode and what its show notes link, the books it names. Uses your AI key, and Google searches for videos. A lookup that searches takes about half a minute."

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const FOUND_AS: Record<string, { what: string; wrong: string }> = {
  FULL: { what: "the full recording", wrong: "Wrong video" },
  CLIP: { what: "the same clip", wrong: "Wrong video" },
  EPISODE: { what: "the podcast episode", wrong: "Wrong episode" },
}

/** What is known about where an entry came from when no link led to it, and what can be done about it. */
function LookupLine({
  item,
  lookupsAvailable,
  onChanged,
}: {
  item: MediaItem
  lookupsAvailable: boolean
  onChanged: () => void
}) {
  const [pending, setPending] = useState<"lookup" | "reject" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lookup = item.lookup
  if (!lookup) return null

  const run = async (action: "lookup" | "reject") => {
    setPending(action)
    setError(null)
    try {
      const res =
        action === "lookup"
          ? await fetch(`/api/links/${lookup.postId}/lookup`, { method: "POST" })
          : await fetch(`/api/links/${item.id}/found`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "That didn't work")
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : "That didn't work")
    } finally {
      setPending(null)
    }
  }

  const action = (name: "lookup" | "reject", label: string) => (
    <button
      type="button"
      disabled={pending !== null}
      onClick={() => run(name)}
      title={name === "lookup" ? LOOKUP_HELP : "Remove it. It won't be suggested for this link again."}
      className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground disabled:opacity-60"
    >
      {pending === name && <Loader2 className="h-3 w-3 animate-spin" />}
      {pending === name && name === "lookup" ? "Looking…" : label}
    </button>
  )

  let text: React.ReactNode
  let actions: React.ReactNode = null
  if (item.via === "AI_LOOKUP" && item.role === "BOOK") {
    text = "Named in a link you saved and matched in Open Library by title and author."
    actions = action("reject", "Wrong book")
  } else if (item.via === "AI_LOOKUP") {
    const found = FOUND_AS[item.role ?? "FULL"] ?? FOUND_AS.FULL
    text = (
      <>
        <Sparkles className="mr-1 inline h-3 w-3" />
        Found by AI: probably {found.what} this post is about.{lookup.note ? ` ${lookup.note}` : ""}
      </>
    )
    actions = action("reject", found.wrong)
  } else if (lookup.status === "RUNNING") {
    text = "Looking for the public source of this video…"
  } else {
    text =
      lookup.status === "FAILED"
        ? `The lookup failed${lookup.note ? `: ${shorten(lookup.note, 160)}` : "."}`
        : lookup.status === "FOUND"
          ? "Uploaded to the post. No public video was found for it."
          : lookup.status === "NOT_FOUND" || lookup.status === "SKIPPED" || lookup.status === "REJECTED"
            ? lookup.note || "No public source was found."
            : "Uploaded to the post. Its public source hasn't been looked up."
    if (lookupsAvailable) {
      actions = action("lookup", lookup.status && lookup.status !== "PENDING" ? "Look again" : "Find source")
    }
  }

  return (
    <p className="text-xs text-muted-foreground">
      {text}
      {actions && <> {actions}</>}
      {error && <span className="ml-1.5 text-red-600 dark:text-red-400">{error}</span>}
    </p>
  )
}

function MediaRow({
  item,
  showType,
  lookupsAvailable,
  onChanged,
}: {
  item: MediaItem
  showType: boolean
  lookupsAvailable: boolean
  onChanged: () => void
}) {
  const info = TYPE_INFO[item.type]
  const Icon = info.icon
  const [moving, setMoving] = useState(false)
  const [moveMessage, setMoveMessage] = useState<string | null>(null)

  // Make a link from an episode's show notes a feed link of its own: fetched and analyzed
  const moveToFeed = async () => {
    setMoving(true)
    setMoveMessage(null)
    try {
      const res = await fetch(`/api/links/${item.id}/move-to-feed`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "Couldn't move the link")
      if (data.message) setMoveMessage(data.message)
      onChanged()
    } catch (err) {
      setMoveMessage(err instanceof Error ? err.message : "Couldn't move the link")
    } finally {
      setMoving(false)
    }
  }

  // A show-notes link's description only says which episode it is from, which the line below says too
  const blurb = item.summary || (item.via === "SHOW_NOTES" && item.post ? null : item.description)

  return (
    <article className="flex gap-3 border-b py-4 last:border-b-0">
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        tabIndex={-1}
        aria-hidden="true"
        className="flex h-[54px] w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted sm:h-[72px] sm:w-32"
      >
        {item.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.imageUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            // A book cover is upright: show all of it in the wide frame
            className={cn("h-full w-full", item.type === "book" ? "object-contain" : "object-cover")}
          />
        ) : (
          <Icon className="h-6 w-6 text-muted-foreground" />
        )}
      </a>

      <div className="min-w-0 flex-1 space-y-1">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium leading-snug hover:underline break-words"
        >
          {item.title || item.url}
          <ExternalLink className="ml-1 inline h-3.5 w-3.5 align-baseline text-muted-foreground" />
        </a>

        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {showType && (
            <Badge variant="secondary" className="gap-1 text-[10px]">
              <Icon className="h-3 w-3" />
              {info.singular}
            </Badge>
          )}
          <span>{[displayDomain(item.domain), formatDate(item.sharedAt)].filter(Boolean).join(" · ")}</span>
          {item.via === "POST_VIDEO" && <span>· Video on X</span>}
          {item.duplicates > 0 && <span>· shared {item.duplicates + 1} times</span>}
          {item.source === "ai" && (
            <span className="inline-flex items-center gap-0.5" title="Recognized by the AI analysis, not by its address">
              · <Sparkles className="h-3 w-3" /> AI-tagged
            </span>
          )}
          {item.isLiked && (
            <span className="inline-flex items-center gap-0.5">
              · <Heart className="h-3 w-3 fill-current" /> Liked
            </span>
          )}
          {item.isRead && (
            <span className="inline-flex items-center gap-0.5">
              · <Eye className="h-3 w-3" /> Read
            </span>
          )}
        </p>

        {blurb && <p className="line-clamp-2 text-sm text-muted-foreground">{blurb}</p>}

        <LookupLine item={item} lookupsAvailable={lookupsAvailable} onChanged={onChanged} />

        <p className="text-xs text-muted-foreground">
          {item.alternate && (
            <>
              <a
                href={item.alternate.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
                title={item.alternate.title ?? undefined}
              >
                Short clip
                <ExternalLink className="ml-0.5 inline h-3 w-3 align-baseline" />
              </a>
              {" · "}
            </>
          )}
          {item.post && (
            <>
              {item.via === "AI_LOOKUP"
                ? item.role === "BOOK"
                  ? "Mentioned in "
                  : "Found for "
                : item.via === "SHOW_NOTES"
                  ? "From the show notes of "
                  : item.via === "QUOTED_POST"
                  ? "Linked in the post quoted by "
                  : "Linked from "}
              <a
                href={item.post.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline-offset-2 hover:underline"
              >
                {item.post.title
                  ? `“${shorten(item.post.title, 80)}”`
                  : `a post on ${displayDomain(item.post.domain) ?? "social media"}`}
              </a>
              {" · "}
            </>
          )}
          {!item.post && item.originNote && <>{shorten(item.originNote, 90)} · </>}
          <Link href={`/feed?link=${item.feedLinkId}`} className="underline-offset-2 hover:underline">
            Open in feed
          </Link>
          {item.via === "SHOW_NOTES" && (
            <>
              {" · "}
              <button
                type="button"
                onClick={moveToFeed}
                disabled={moving}
                title="Fetch this page and analyze it as a link of its own in your feed"
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground disabled:opacity-60"
              >
                {moving && <Loader2 className="h-3 w-3 animate-spin" />}
                Move to feed
              </button>
            </>
          )}
          {moveMessage && <span className="ml-1.5">{moveMessage}</span>}
        </p>
      </div>
    </article>
  )
}

export function MediaContainer() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const typeParam = searchParams.get("type")
  const type: MediaType | null = isMediaType(typeParam) ? typeParam : null
  const search = searchParams.get("search") || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1)

  const { data, items, isLoading, error, mutate } = useMedia(type, search, page)
  const refresh = useCallback(() => {
    mutate()
  }, [mutate])
  const { progress, start, stop } = useMediaRescan(refresh)
  const lookups = useLookups(refresh)
  const lookupsAvailable = !!data && !data.lookups.unavailable
  const waitingLookups = lookups.progress.running ? lookups.progress.remaining : (data?.lookups.pending ?? 0)

  const navigate = (next: { type?: MediaType | null; page?: number }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next.type !== undefined) {
      if (next.type === null) params.delete("type")
      else params.set("type", next.type)
      params.delete("page")
    }
    if (next.page !== undefined) {
      if (next.page === 1) params.delete("page")
      else params.set("page", String(next.page))
    }
    const query = params.toString()
    router.push(`${pathname}${query ? `?${query}` : ""}`)
  }

  const tabs: Array<{ key: MediaType | null; label: string; count: number | undefined }> = [
    { key: null, label: "All", count: data?.counts.all },
    ...MEDIA_TYPES.map((t) => ({ key: t, label: TYPE_INFO[t].label, count: data?.counts[t] })),
  ]

  const scanTotal = progress.scanned + progress.remaining

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <nav aria-label="Media types" className="flex flex-wrap gap-2">
          {tabs.map((tab) => {
            const active = tab.key === type
            return (
              <button
                key={tab.key ?? "all"}
                type="button"
                onClick={() => navigate({ type: tab.key })}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "bg-white hover:bg-muted dark:bg-zinc-900"
                )}
              >
                {tab.label}
                {tab.count !== undefined && (
                  <span className={cn("tabular-nums", active ? "opacity-80" : "text-muted-foreground")}>
                    {tab.count}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
        <div className="flex flex-wrap gap-2">
          {lookups.progress.running ? (
            <Button variant="outline" size="sm" onClick={lookups.stop}>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Stop lookups
            </Button>
          ) : (
            waitingLookups > 0 &&
            lookupsAvailable && (
              <Button variant="outline" size="sm" onClick={lookups.start} title={LOOKUP_HELP}>
                <Search className="mr-1.5 h-3.5 w-3.5" />
                Find sources
                <span className="ml-1.5 tabular-nums text-muted-foreground">{waitingLookups}</span>
              </Button>
            )
          )}
          {progress.running ? (
            <Button variant="outline" size="sm" onClick={stop}>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Stop scan
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={start} title={SCAN_HELP}>
              <ScanSearch className="mr-1.5 h-3.5 w-3.5" />
              {progress.scanned > 0 && !progress.finished ? "Resume scan" : "Scan saved posts"}
            </Button>
          )}
        </div>
      </div>

      {(lookups.progress.running || lookups.progress.processed > 0 || lookups.progress.error) && (
        <p
          className={cn(
            "text-xs",
            lookups.progress.error ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
          )}
          role="status"
        >
          {lookups.progress.error
            ? `${lookups.progress.error} `
            : lookups.progress.running
              ? "Looking for sources… "
              : "Lookups done. "}
          {lookups.progress.processed} {lookups.progress.processed === 1 ? "link" : "links"} checked,{" "}
          {lookups.progress.found} with something found
          {lookups.progress.remaining > 0 ? `, ${lookups.progress.remaining} to go.` : "."}
        </p>
      )}
      {data && data.lookups.unavailable && data.lookups.pending > 0 && (
        <p className="text-xs text-muted-foreground">
          {data.lookups.pending} saved {data.lookups.pending === 1 ? "link points" : "links point"} at a video,
          a podcast or a book without linking it. {data.lookups.unavailable}
        </p>
      )}

      {(progress.running || progress.scanned > 0 || progress.finished || progress.error) && (
        <p
          className={cn("text-xs", progress.error ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}
          role="status"
        >
          {progress.error
            ? `${progress.error}. Checked ${progress.scanned} before it stopped.`
            : progress.finished
              ? `Scan done. Checked ${progress.scanned} ${progress.scanned === 1 ? "link" : "links"}.`
              : progress.running
                ? `Scanning saved links: ${progress.scanned} of ${scanTotal} checked…`
                : `Scan stopped after ${progress.scanned} of ${scanTotal}.`}{" "}
          {progress.linksFound} new {progress.linksFound === 1 ? "link" : "links"} found,{" "}
          {progress.titlesFilled} {progress.titlesFilled === 1 ? "title" : "titles"} filled in,{" "}
          {progress.addressesCleaned} {progress.addressesCleaned === 1 ? "address" : "addresses"} cleaned.
        </p>
      )}

      <LinkSearch placeholder="Search media by title or URL..." />

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          Failed to load your media. Please try again.
        </div>
      ) : isLoading ? (
        <div className="space-y-3 rounded-lg border bg-white p-4 dark:bg-zinc-900">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-3 py-2">
              <Skeleton className="h-[54px] w-24 shrink-0 sm:h-[72px] sm:w-32" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-white p-10 text-center text-muted-foreground dark:bg-zinc-900">
          {search
            ? "Nothing matches that search."
            : `No ${type ? TYPE_INFO[type].label.toLowerCase() : "media"} found in your links yet. “Scan saved posts” looks through posts you already synced.`}
        </div>
      ) : (
        <>
          <div className="rounded-lg border bg-white px-4 dark:bg-zinc-900">
            {items.map((item) => (
              <MediaRow
                key={item.id}
                item={item}
                showType={type === null}
                lookupsAvailable={lookupsAvailable}
                onChanged={refresh}
              />
            ))}
          </div>
          {data && data.pagination.totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={data.pagination.totalPages}
              total={data.pagination.total}
              limit={data.pagination.limit}
              onPageChange={(p) => navigate({ page: p })}
            />
          )}
        </>
      )}

    </div>
  )
}
