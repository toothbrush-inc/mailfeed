"use client"

import { useEffect, useRef, useState } from "react"

interface SocialEmbedProps {
  html: string
  url: string
  domain: string | null
}

// Domains that use oEmbed and can render embeds
const EMBED_DOMAINS = ["twitter.com", "x.com", "instagram.com", "tiktok.com", "youtube.com"]

declare global {
  interface Window {
    twttr?: {
      ready: (callback: () => void) => void
      widgets: {
        load: (element?: HTMLElement) => void
        createTweet: (
          tweetId: string,
          container: HTMLElement,
          options?: { theme?: string; align?: string }
        ) => Promise<HTMLElement>
      }
    }
    instgrm?: {
      Embeds: {
        process: () => void
      }
    }
  }
}

export function isEmbeddable(domain: string | null, html: string | null, url?: string | null): boolean {
  if (!domain || !html) return false

  // X/Twitter article URLs should NOT be embedded - they're articles, not tweets
  if (url) {
    try {
      const parsed = new URL(url)
      if (parsed.pathname.toLowerCase().startsWith("/i/article/")) {
        return false
      }
    } catch {
      // ignore invalid URLs
    }
  }

  const normalizedDomain = domain.replace("www.", "")
  return EMBED_DOMAINS.some((d) => normalizedDomain.includes(d))
}

// Extract tweet ID from Twitter/X URL
function extractTweetId(url: string): string | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/)
  return match ? match[1] : null
}

// Extract YouTube video ID from various URL formats
function extractYouTubeId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  )
  return match ? match[1] : null
}

// Strip elements from HTML that cause issues when rendered inline
// (relative resource URLs, iframes blocked by X-Frame-Options, etc.)
function sanitizeEmbedHtml(html: string): string {
  return html
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, "")
    .replace(/<iframe[^>]*\/>/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
}

export function SocialEmbed({ html, url, domain }: SocialEmbedProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    // Prevent double-loading in React StrictMode
    if (hasLoadedRef.current) return
    if (!containerRef.current) return

    hasLoadedRef.current = true
    const normalizedDomain = domain?.replace("www.", "") || ""

    // Twitter/X embeds
    if (normalizedDomain.includes("twitter.com") || normalizedDomain.includes("x.com")) {
      const tweetId = extractTweetId(url)
      if (tweetId) {
        loadTwitterEmbed(tweetId)
      } else {
        // Fallback to loading the blockquote HTML
        loadTwitterWidget()
      }
      return
    }

    // Instagram embeds
    if (normalizedDomain.includes("instagram.com")) {
      renderHtmlAndLoadScript("instagram")
      return
    }

    // YouTube — construct a proper embed iframe from the video ID
    if (normalizedDomain.includes("youtube.com") || normalizedDomain.includes("youtu.be")) {
      const videoId = extractYouTubeId(url)
      if (videoId && containerRef.current) {
        containerRef.current.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" style="width:100%;aspect-ratio:16/9;border-radius:8px"></iframe>`
      } else {
        renderHtml()
      }
      setIsLoaded(true)
      return
    }

    // TikTok embeds
    if (normalizedDomain.includes("tiktok.com")) {
      renderHtmlAndLoadScript("tiktok")
      return
    }

    // Default: just render the HTML
    renderHtml()
    setIsLoaded(true)
  }, [html, url, domain])

  const renderHtml = () => {
    if (containerRef.current && html) {
      containerRef.current.innerHTML = sanitizeEmbedHtml(html)
    }
  }

  const renderHtmlAndLoadScript = (platform: "instagram" | "tiktok") => {
    renderHtml()

    if (platform === "instagram") {
      loadScript("instagram-embed", "https://www.instagram.com/embed.js", () => {
        window.instgrm?.Embeds.process()
        setIsLoaded(true)
      })
    } else if (platform === "tiktok") {
      loadScript("tiktok-embed", "https://www.tiktok.com/embed.js", () => {
        setIsLoaded(true)
      })
    }
  }

  const loadTwitterEmbed = (tweetId: string) => {
    loadScript("twitter-wjs", "https://platform.twitter.com/widgets.js", () => {
      if (window.twttr && containerRef.current) {
        // Clear container and create tweet directly
        containerRef.current.innerHTML = ""

        window.twttr.widgets
          .createTweet(tweetId, containerRef.current, {
            align: "center",
          })
          .then((el) => {
            if (el) {
              setIsLoaded(true)
            } else {
              setError("Failed to load tweet")
              // Show fallback HTML
              renderHtml()
            }
          })
          .catch((err) => {
            console.error("Twitter embed error:", err)
            setError("Failed to load tweet")
            renderHtml()
          })
      }
    })
  }

  const loadTwitterWidget = () => {
    renderHtml()
    loadScript("twitter-wjs", "https://platform.twitter.com/widgets.js", () => {
      if (window.twttr && containerRef.current) {
        window.twttr.widgets.load(containerRef.current)
        setIsLoaded(true)
      }
    })
  }

  const loadScript = (id: string, src: string, onLoad: () => void) => {
    // Check if script already loaded
    if (document.getElementById(id)) {
      // Script exists, check if API is ready
      const checkReady = setInterval(() => {
        if (
          (id === "twitter-wjs" && window.twttr?.widgets) ||
          (id === "instagram-embed" && window.instgrm) ||
          id === "tiktok-embed"
        ) {
          clearInterval(checkReady)
          onLoad()
        }
      }, 50)
      setTimeout(() => clearInterval(checkReady), 5000)
      return
    }

    const script = document.createElement("script")
    script.id = id
    script.src = src
    script.async = true
    script.onload = () => {
      // For Twitter, wait for twttr.ready
      if (id === "twitter-wjs") {
        if (window.twttr) {
          window.twttr.ready(onLoad)
        }
      } else {
        onLoad()
      }
    }
    script.onerror = () => {
      setError("Failed to load embed script")
      renderHtml()
      setIsLoaded(true)
    }
    document.head.appendChild(script)
  }

  if (!html) return null

  return (
    <div className="social-embed-wrapper">
      <div
        ref={containerRef}
        className="social-embed [&_iframe]:max-w-full [&_.twitter-tweet]:mx-auto"
      />
      {!isLoaded && !error && (
        <div className="flex items-center justify-center p-4 text-sm text-muted-foreground">
          Loading embed...
        </div>
      )}
      {error && (
        <p className="text-xs text-muted-foreground mt-1">{error}</p>
      )}
    </div>
  )
}
