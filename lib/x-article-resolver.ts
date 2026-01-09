/**
 * X.com Article URL Resolver
 *
 * Converts anonymous X article URLs like:
 *   https://x.com/i/article/2008184661902544896
 *
 * To canonical URLs like:
 *   https://x.com/username/article/2008184661902544896
 *   or
 *   https://x.com/username/status/2008184661902544896
 */

const X_ARTICLE_PATTERN = /^https?:\/\/(x\.com|twitter\.com)\/i\/article\/(\d+)/i

export interface XArticleUrlInfo {
  isXArticle: boolean
  articleId: string | null
  originalUrl: string
  needsUsername: boolean
}

export interface ResolvedXArticle {
  success: boolean
  canonicalUrl: string | null
  username: string | null
  articleId: string
  error?: string
}

/**
 * Check if a URL is an anonymous X article URL that needs resolution
 */
export function parseXArticleUrl(url: string): XArticleUrlInfo {
  const match = url.match(X_ARTICLE_PATTERN)

  if (match) {
    return {
      isXArticle: true,
      articleId: match[2],
      originalUrl: url,
      needsUsername: true,
    }
  }

  return {
    isXArticle: false,
    articleId: null,
    originalUrl: url,
    needsUsername: false,
  }
}

/**
 * Build canonical X article URL with username
 */
export function buildXArticleUrl(articleId: string, username: string, asStatus: boolean = false): string {
  const cleanUsername = username.replace(/^@/, '').trim()

  if (asStatus) {
    return `https://x.com/${cleanUsername}/status/${articleId}`
  }

  return `https://x.com/${cleanUsername}/article/${articleId}`
}

/**
 * Try to resolve the canonical URL by following redirects
 * X.com often redirects /i/article/ URLs to the proper /username/article/ URL
 */
export async function resolveXArticleUrl(url: string): Promise<ResolvedXArticle> {
  const parsed = parseXArticleUrl(url)

  if (!parsed.isXArticle || !parsed.articleId) {
    return {
      success: false,
      canonicalUrl: null,
      username: null,
      articleId: '',
      error: 'Not an X article URL',
    }
  }

  try {
    // Try to fetch with redirect following to get canonical URL
    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
    })

    const finalUrl = response.url

    // Check if we got redirected to a URL with username
    const usernameMatch = finalUrl.match(/https?:\/\/(x\.com|twitter\.com)\/([^/]+)\/(article|status)\/(\d+)/i)

    if (usernameMatch && usernameMatch[2] !== 'i') {
      return {
        success: true,
        canonicalUrl: finalUrl,
        username: usernameMatch[2],
        articleId: usernameMatch[4],
      }
    }

    // If HEAD didn't work, try GET and look for og:url or canonical link
    const getResponse = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      },
    })

    const html = await getResponse.text()

    // Look for canonical URL in meta tags
    const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)

    if (canonicalMatch) {
      const canonical = canonicalMatch[1]
      const extractedUsername = canonical.match(/https?:\/\/(x\.com|twitter\.com)\/([^/]+)\/(article|status)\/(\d+)/i)

      if (extractedUsername && extractedUsername[2] !== 'i') {
        return {
          success: true,
          canonicalUrl: canonical,
          username: extractedUsername[2],
          articleId: extractedUsername[4],
        }
      }
    }

    // Look for author username in the page content
    const authorMatch = html.match(/"screen_name":"([^"]+)"/i)
      || html.match(/@([a-zA-Z0-9_]+)/g)

    if (authorMatch) {
      const username = Array.isArray(authorMatch)
        ? authorMatch[0].replace('@', '')
        : authorMatch[1]

      return {
        success: true,
        canonicalUrl: buildXArticleUrl(parsed.articleId, username),
        username,
        articleId: parsed.articleId,
      }
    }

    // Could not resolve
    return {
      success: false,
      canonicalUrl: null,
      username: null,
      articleId: parsed.articleId,
      error: 'Could not resolve username from URL',
    }

  } catch (error) {
    return {
      success: false,
      canonicalUrl: null,
      username: null,
      articleId: parsed.articleId,
      error: error instanceof Error ? error.message : 'Failed to resolve URL',
    }
  }
}

/**
 * Check if a URL is any kind of X/Twitter URL
 */
export function isXUrl(url: string): boolean {
  return /^https?:\/\/(x\.com|twitter\.com)/i.test(url)
}

/**
 * Check if URL is a resolvable X article (needs username)
 */
export function needsXArticleResolution(url: string): boolean {
  return X_ARTICLE_PATTERN.test(url)
}

/**
 * Extract username from an X/Twitter URL
 * Works with: x.com/username/status/123, twitter.com/username, etc.
 */
export function extractUsernameFromXUrl(url: string): string | null {
  // Match x.com/username or twitter.com/username (not /i/, /search, /home, etc.)
  const match = url.match(/^https?:\/\/(x\.com|twitter\.com)\/([a-zA-Z0-9_]+)(?:\/|$)/i)

  if (match) {
    const username = match[2]
    // Filter out reserved paths
    const reservedPaths = ['i', 'search', 'home', 'explore', 'notifications', 'messages', 'settings', 'compose', 'intent', 'hashtag']
    if (!reservedPaths.includes(username.toLowerCase())) {
      return username
    }
  }

  return null
}

/**
 * Resolve an X article URL using a parent URL's username
 * Useful when article links are found in tweets - we can use the tweet author's username
 */
export function resolveXArticleFromParent(articleUrl: string, parentUrl: string): string | null {
  const parsed = parseXArticleUrl(articleUrl)
  if (!parsed.isXArticle || !parsed.articleId) {
    return null
  }

  const username = extractUsernameFromXUrl(parentUrl)
  if (!username) {
    return null
  }

  return buildXArticleUrl(parsed.articleId, username)
}
