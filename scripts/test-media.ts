/**
 * Media: which links count as a video, podcast, book or game, that media
 * links inside posts are kept as nested links, the Media list (types,
 * counts, search, de-duplication, hidden domains, other users' links), and
 * the media lookup: reading a post's context, flagging posts and pages
 * for a lookup, matching podcast episodes and books in their catalogs,
 * reading an episode's show notes from its feed,
 * how what the lookup finds is listed and rejected, and the fee for the
 * lookup's Google searches.
 *
 * Nothing here calls an AI model, X or a catalog: their answers are fixtures. The rule checks need nothing. The
 * list checks need a throwaway database and are skipped without DATABASE_URL:
 *
 *   docker run -d --name mailfeed-media-test -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=mailfeed_test -p 5604:5432 pgvector/pgvector:pg16
 *   DATABASE_URL=postgresql://postgres:test@localhost:5604/mailfeed_test \
 *     npx prisma migrate deploy
 *   DATABASE_URL=postgresql://postgres:test@localhost:5604/mailfeed_test \
 *     npm run test:media
 *   docker rm -f mailfeed-media-test
 */
import { classifyMedia, classifyMediaUrl, mediaKey, youtubeVideoId, type MediaType } from "../lib/media"
import { isSkippedNestedUrl } from "../lib/nested-link-extractor"
import { mayNameBook, mayReferToRecording, parsePostContext, postIdFromUrl, postVideoPart } from "../lib/post-context"
import { appleEpisodeIds, authorSurnames, matchBook, normalizeTitle, parsePodcastEpisodes, parsePodcastShow } from "../lib/catalogs"
import { findFeedItem, linksInShowNotes, parseShowNotes } from "../lib/show-notes"

let failures = 0
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`  ok  ${name}`)
  else {
    failures++
    console.error(`FAIL  ${name}`, detail ?? "")
  }
}

const URL_CASES: Array<[string, MediaType | null]> = [
  // Videos
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ["https://youtu.be/dQw4w9WgXcQ?si=abc123", "video"],
  ["https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be", "video"],
  ["https://www.youtube.com/shorts/abcdefghijk", "video"],
  ["https://www.youtube.com/live/abcdefghijk?t=120", "video"],
  ["https://www.youtube.com/playlist?list=PL123", "video"],
  ["https://www.youtube.com/@veritasium", null],
  ["https://www.youtube.com/channel/UC123", null],
  ["https://www.youtube.com/", null],
  ["https://vimeo.com/123456789", "video"],
  ["https://vimeo.com/blog/post/some-news", null],
  ["https://www.twitch.tv/videos/1234567", "video"],
  ["https://www.twitch.tv/somechannel", null],
  ["https://www.ted.com/talks/some_talk", "video"],
  ["https://www.tiktok.com/@someone/video/7234567890123456789", "video"],
  ["https://www.tiktok.com/@someone", null],
  ["https://www.instagram.com/reel/Cabc123/", "video"],
  ["https://www.instagram.com/p/Cabc123/", null],
  ["https://www.loom.com/share/0123456789abcdef", "video"],
  ["https://example.com/files/demo.mp4", "video"],
  // Podcasts
  ["https://podcasts.apple.com/us/podcast/some-show/id123456?i=1000", "podcast"],
  ["https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk", "podcast"],
  ["https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk?si=x", "podcast"],
  ["https://open.spotify.com/track/4rOoJ6Egrf8K2IrywzwOMk", null],
  ["https://overcast.fm/+AbCdEf", "podcast"],
  ["https://pca.st/episode/abc", "podcast"],
  ["https://share.transistor.fm/s/abc123", "podcast"],
  ["https://transistor.fm/pricing/", null],
  ["https://a16z.com/podcast/some-episode/", "podcast"],
  ["https://www.nytimes.com/2025/01/02/podcasts/the-daily/episode.html", "podcast"],
  ["https://podcast.example.com/episodes/12", "podcast"],
  ["https://example.com/blog/why-podcasts-are-everywhere", null],
  ["https://www.audible.com/podcast/Some-Show/B08K123456", "podcast"],
  // Books
  ["https://www.goodreads.com/book/show/5907.The_Hobbit", "book"],
  ["https://www.goodreads.com/author/show/656983.J_R_R_Tolkien", null],
  ["https://www.amazon.com/Hobbit-J-R-R-Tolkien/dp/054792822X/ref=sr_1_1", "book"],
  ["https://www.amazon.co.uk/dp/054792822X", "book"],
  ["https://www.amazon.com/Some-Novel-Author-ebook/dp/B00ABCDEFG", "book"],
  ["https://www.amazon.com/Anker-Charger-Compact/dp/B0ABCDEFGH", null],
  ["https://www.audible.com/pd/The-Hobbit-Audiobook/B0099RKRTY", "book"],
  ["https://books.google.com/books?id=abc123", "book"],
  ["https://bookshop.org/p/books/the-hobbit/123", "book"],
  ["https://openlibrary.org/works/OL27482W/The_Hobbit", "book"],
  ["https://www.gutenberg.org/ebooks/1342", "book"],
  ["https://press.stripe.com/the-art-of-doing-science-and-engineering", "book"],
  ["https://press.stripe.com/", null],
  ["https://www.oreilly.com/library/view/designing-data-intensive/9781491903063/", "book"],
  ["https://www.oreilly.com/radar/some-article/", null],
  ["https://www.nytimes.com/2025/01/02/books/review/some-novel.html", null],
  // Games
  ["https://store.steampowered.com/app/1145360/Hades/", "game"],
  ["https://store.steampowered.com/news/app/1145360", null],
  ["https://someone.itch.io/a-small-game", "game"],
  ["https://itch.io/blog/123/some-post", null],
  ["https://store.epicgames.com/en-US/p/hades", "game"],
  ["https://www.gog.com/en/game/the_witcher_3", "game"],
  ["https://www.nintendo.com/us/store/products/hades-switch/", "game"],
  ["https://boardgamegeek.com/boardgame/174430/gloomhaven", "game"],
  // Not media
  ["https://example.com/an-article", null],
  ["https://x.com/someone/status/1234567890", null],
  ["mailto:someone@example.com", null],
  ["not a url", null],
]

// The embed endpoint's answer for a post that quotes a post with an uploaded video (trimmed)
const QUOTING_POST = {
  __typename: "Tweet",
  id_str: "2106565003608502767",
  text: "I know about 5 people from my class who've done what Peter Thiel recommends here.",
  user: { name: "Rishab Mishra", screen_name: "rishabmishraa" },
  entities: {},
  quoted_tweet: {
    id_str: "2106534802824552570",
    text: "Peter Thiel on how you should think about your future: https://t.co/5agCVbZtKO",
    user: { name: "Startup Wisdom", screen_name: "StartupWisdom_" },
    entities: {
      urls: [{ expanded_url: "https://example.com/the-full-talk", url: "https://t.co/abc" }],
      media: [{ expanded_url: "https://x.com/StartupWisdom_/status/2106534802824552570/video/1" }],
    },
    mediaDetails: [
      {
        type: "video",
        media_url_https: "https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg",
        video_info: { duration_millis: 61323, variants: [] },
      },
    ],
  },
}

function ruleChecks() {
  console.log("Post context")
  check("post id from an x.com URL", postIdFromUrl("https://x.com/someone/status/2106565003608502767?s=20") === "2106565003608502767")
  check("post id from a twitter.com URL", postIdFromUrl("https://twitter.com/someone/status/20") === "20")
  check("no post id for a profile or an article", postIdFromUrl("https://x.com/someone") === null && postIdFromUrl("https://x.com/i/article/123") === null)

  const context = parsePostContext(QUOTING_POST)
  check("the post's own text and author", context?.author.handle === "rishabmishraa" && context.text.startsWith("I know about 5"), context)
  check("the quoted post is read", context?.quoted?.url === "https://x.com/StartupWisdom_/status/2106534802824552570", context?.quoted)
  check("the quoted post's links are the written ones, not t.co", context?.quoted?.urls.join() === "https://example.com/the-full-talk", context?.quoted?.urls)
  check(
    "the uploaded video is found on the quoted post",
    context?.video === null && context?.quoted?.video?.durationMs === 61323 && postVideoPart(context)?.id === "2106534802824552570",
    context?.quoted?.video
  )
  check("a deleted post has no context", parsePostContext({ __typename: "TweetTombstone" }) === null)
  check("junk has no context", parsePostContext("nope") === null && parsePostContext({}) === null)
  check(
    "a GIF is not a video",
    parsePostContext({ id_str: "1", text: "lol", mediaDetails: [{ type: "animated_gif" }], video: { poster: "x" } })?.video === null
  )

  const plain = (text: string) => parsePostContext({ id_str: "1", text, user: { screen_name: "a" } })
  check("a post with an uploaded video may refer to a recording", mayReferToRecording(context))
  check("so may a post that talks about one", mayReferToRecording(plain("Best interview I've heard all year")))
  check("an ordinary post does not", !mayReferToRecording(plain("Shipping the new release today")))
  check("no context, no lookup", !mayReferToRecording(null) && !mayNameBook(null))
  check("a post about a book may name one", mayNameBook(plain("Just finished The Making of the Atomic Bomb. What a book.")))
  check("'worth a read' is not a book", !mayNameBook(plain("This thread is worth a read")))

  console.log("Catalogs")
  const itunes = {
    results: [
      {
        wrapperType: "podcastEpisode",
        trackName: "#333 – Andrej Karpathy: Tesla AI, Self-Driving, Optimus, Aliens, and AGI",
        collectionName: "Lex Fridman Podcast",
        trackViewUrl: "https://podcasts.apple.com/us/podcast/333-andrej-karpathy/id1434243584?i=1000584347473&uo=4",
        releaseDate: "2022-10-29T16:51:26Z",
        shortDescription: "Andrej Karpathy is a legendary AI researcher.",
        artworkUrl600: "https://example.com/art600.jpg",
      },
      { wrapperType: "track", kind: "podcast", collectionName: "A show, not an episode", trackViewUrl: "https://podcasts.apple.com/us/podcast/id1" },
      { wrapperType: "podcastEpisode", trackName: "No page for this one" },
    ],
  }
  const episodes = parsePodcastEpisodes(itunes)
  check("only episodes with a page are kept", episodes.length === 1, episodes)
  check(
    "an episode keeps what makes it that episode and drops tracking",
    episodes[0]?.url === "https://podcasts.apple.com/us/podcast/333-andrej-karpathy/id1434243584?i=1000584347473",
    episodes[0]?.url
  )
  check("with its show, date and artwork", episodes[0]?.show === "Lex Fridman Podcast" && episodes[0].released === "2022-10-29" && !!episodes[0].imageUrl, episodes[0])
  check("the episode's page is recognized as a podcast", classifyMediaUrl(episodes[0]?.url) === "podcast")
  check("an unexpected answer gives no episodes", parsePodcastEpisodes(null).length === 0 && parsePodcastEpisodes({ results: "x" }).length === 0)

  console.log("Show notes")
  check(
    "an Apple episode address gives the show and the episode",
    appleEpisodeIds("https://podcasts.apple.com/us/podcast/costco/id1050462261?i=1000625088063&uo=4")?.showId === "1050462261" &&
      appleEpisodeIds("https://podcasts.apple.com/us/podcast/costco/id1050462261?i=1000625088063")?.trackId === "1000625088063"
  )
  check(
    "a show's page, or another site, does not",
    appleEpisodeIds("https://podcasts.apple.com/us/podcast/acquired/id1050462261") === null &&
      appleEpisodeIds("https://open.spotify.com/episode/abc?i=1") === null &&
      appleEpisodeIds("nope") === null
  )
  const show = parsePodcastShow({
    results: [
      { wrapperType: "track", kind: "podcast", collectionName: "Acquired", feedUrl: "https://feeds.example.com/acquired" },
      { wrapperType: "podcastEpisode", trackId: 1000625088063, trackName: "Costco", episodeGuid: "guid-costco", trackViewUrl: "https://podcasts.apple.com/us/podcast/costco/id1050462261?i=1000625088063" },
    ],
  })
  check(
    "a show lookup gives the feed and each episode's id in it",
    show?.feedUrl === "https://feeds.example.com/acquired" && show.episodes[0]?.trackId === "1000625088063" && show.episodes[0].guid === "guid-costco",
    show
  )
  check("an answer without a show is no show", parsePodcastShow({ results: [] }) === null && parsePodcastShow(null) === null)

  const feed = `<?xml version="1.0"?><rss><channel><title>Acquired</title>
    <item><title>Nike</title><guid isPermaLink="false">guid-nike</guid><description><![CDATA[<p>About <a href="https://example.com/shoe-dog">Shoe Dog</a></p>]]></description></item>
    <item><title><![CDATA[Costco]]></title><itunes:title>Costco</itunes:title><guid isPermaLink="false"><![CDATA[guid-costco]]></guid>
      <description>Short teaser.</description>
      <content:encoded><![CDATA[<p>Links:</p><ul><li><a href="https://thescienceofhitting.com">The Science of Hitting</a></li><li><a href="https://www.youtube.com/watch?v=Z1sTs8wkAbw">Warren Buffett's Costco joke</a></li></ul><p>Sponsors:<br>Vanta: https://bit.ly/acquiredvanta.</p><p><a href="https://thescienceofhitting.com">again</a> <a href="mailto:hi@example.com">mail</a></p>]]></content:encoded></item>
    <item><title>Q&amp;A: Ask Us Anything</title><guid>https://example.com/?p=12&amp;v=2</guid><description>&lt;p&gt;See &lt;a href="https://example.com/answers"&gt;the answers&lt;/a&gt;&lt;/p&gt;</description></item>
  </channel></rss>`
  const costcoItem = findFeedItem(feed, { guid: "guid-costco" })
  check("an episode is found in the feed by its guid", !!costcoItem && costcoItem.includes("Science of Hitting") && !costcoItem.includes("Shoe Dog"))
  check("a guid with an escaped ampersand is found too", !!findFeedItem(feed, { guid: "https://example.com/?p=12&v=2" })?.includes("the answers"))
  check("without a guid, the exact title finds it", !!findFeedItem(feed, { title: "Q&A: Ask Us Anything" })?.includes("the answers") && !!findFeedItem(feed, { guid: "gone", title: "nike" })?.includes("Shoe Dog"))
  check("an episode that isn't in the feed is not found", findFeedItem(feed, { guid: "guid-other", title: "Starbucks" }) === null)

  const notes = parseShowNotes(costcoItem!, "Acquired")
  check("the fuller copy of the notes is the one read", notes?.episode === "Costco" && notes.show === "Acquired" && notes.text.includes("Sponsors"), notes?.text)
  check(
    "links keep their text, each address once, written-out addresses included, and nothing that isn't a web link",
    notes?.links.map((l) => `${l.text}=${l.url}`).join(" | ") ===
      "The Science of Hitting=https://thescienceofhitting.com/ | Warren Buffett's Costco joke=https://www.youtube.com/watch?v=Z1sTs8wkAbw | https://bit.ly/acquiredvanta=https://bit.ly/acquiredvanta",
    notes?.links
  )
  check("notes whose markup arrives escaped are still read", linksInShowNotes('&lt;p&gt;See &lt;a href="https://example.com/answers"&gt;the answers&lt;/a&gt;&lt;/p&gt;').links[0]?.text === "the answers")
  check("notes with no links have none", linksInShowNotes("<p>Thanks for listening.</p>").links.length === 0)

  check("titles compare without case, punctuation, accents or a leading article", normalizeTitle("The Making of the Atomic Bomb!") === "making of the atomic bomb" && normalizeTitle("Les Misérables") === "les miserables")
  const openLibrary = {
    docs: [
      { key: "/works/OL1W", title: "Summary of The Making of the Atomic Bomb", author_name: ["Some Summarizer"], edition_count: 1 },
      { key: "/works/OL2617727W", title: "Making of the Atomic Bomb-Part 1", author_name: ["Richard Rhodes"], edition_count: 2, first_publish_year: 1992 },
      { key: "/works/OL2617750W", title: "The making of the atomic bomb", author_name: ["Richard Rhodes"], edition_count: 21, first_publish_year: 1986, cover_i: 123 },
      { key: "/books/OL9M", title: "The Making of the Atomic Bomb", author_name: ["Richard Rhodes"], edition_count: 50 },
    ],
  }
  const rhodes = matchBook({ title: "The Making of the Atomic Bomb", author: "Richard Rhodes" }, openLibrary)
  check("a book is matched by title and author, as the work with the most editions", rhodes?.url === "https://openlibrary.org/works/OL2617750W", rhodes)
  check("with its authors, year and cover", rhodes?.authors.join() === "Richard Rhodes" && rhodes.firstPublished === 1986 && rhodes.imageUrl === "https://covers.openlibrary.org/b/id/123-M.jpg", rhodes)
  check("the matched page is recognized as a book", classifyMediaUrl(rhodes?.url) === "book")
  check("a surname is enough for the author", matchBook({ title: "Making of the Atomic Bomb", author: "Rhodes" }, openLibrary)?.url === rhodes?.url)
  check(
    "each co-author's surname counts, however the initials are written",
    authorSurnames("Ichiro Kishimi and Fumitake Koga").join() === "kishimi,koga" && authorSurnames("W.A. Mathieu").join() === "mathieu" && authorSurnames("Ichirō Kishimi & F. Koga").join() === "kishimi,koga"
  )
  check(
    "a book matches on any of its authors",
    matchBook({ title: "Zero to One", author: "Blake Masters and Peter Thiel" }, { docs: [{ key: "/works/OL7W", title: "Zero to One", author_name: ["Peter A. Thiel", "Blake Masters"], edition_count: 30 }] }) !== null
  )
  check("the wrong author is no match", matchBook({ title: "The Making of the Atomic Bomb", author: "Walter Isaacson" }, openLibrary) === null)
  check("a different title is no match", matchBook({ title: "Dark Sun", author: "Richard Rhodes" }, openLibrary) === null)
  check("without an author, a well-established book with that exact title matches", matchBook({ title: "The Making of the Atomic Bomb" }, openLibrary)?.url === rhodes?.url)
  check(
    "without an author, an obscure title match is not trusted",
    matchBook({ title: "Notes" }, { docs: [{ key: "/works/OL5W", title: "Notes", author_name: ["Anyone"], edition_count: 1 }] }) === null
  )
  check(
    "a subtitle doesn't stop a match",
    matchBook({ title: "Zero to One", author: "Peter Thiel" }, { docs: [{ key: "/works/OL7W", title: "Zero to One: Notes on Startups, or How to Build the Future", author_name: ["Peter Thiel", "Blake Masters"], edition_count: 30 }] })?.url ===
      "https://openlibrary.org/works/OL7W"
  )
  check("an unexpected answer is no match", matchBook({ title: "Dune" }, null) === null && matchBook({ title: "Dune" }, { docs: "x" }) === null)


  console.log("URL rules")
  for (const [url, expected] of URL_CASES) {
    const actual = classifyMediaUrl(url)
    check(`${expected ?? "not media"}: ${url}`, actual === expected, `got ${actual}`)
  }

  console.log("Stored links")
  const viaShortLink = classifyMedia({
    url: "https://amzn.to/3abcdef",
    finalUrl: "https://www.amazon.com/Hobbit-J-R-R-Tolkien/dp/054792822X",
  })
  check("a short link is judged by where it lands", viaShortLink?.type === "book" && viaShortLink.source === "url", viaShortLink)

  const kindleByTitle = classifyMedia({
    url: "https://www.amazon.com/dp/B00ABCDEFG",
    title: "Some Novel - Kindle edition by Author. Literature & Fiction Kindle eBooks @ Amazon.com.",
  })
  check("an Amazon page titled as a Kindle book is a book", kindleByTitle?.type === "book", kindleByTitle)

  const aiBook = classifyMedia({ url: "https://some-publisher.example/the-book", linkTags: ["BOOK"] })
  check("the AI tag is used when no URL rule matches", aiBook?.type === "book" && aiBook.source === "ai", aiBook)

  const urlWins = classifyMedia({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", linkTags: ["ARTICLE"] })
  check("the URL wins over the AI tag", urlWins?.type === "video" && urlWins.source === "url", urlWins)

  check(
    "an article with an embedded clip stays an article",
    classifyMedia({ url: "https://example.com/story", linkTags: ["ARTICLE", "VIDEO"] }) === null
  )
  check(
    "an AI-tagged video page is a video",
    classifyMedia({ url: "https://example.com/watch/1", linkTags: ["VIDEO"] })?.type === "video"
  )
  check(
    "older AUDIO analyses count when the page reads as a podcast",
    classifyMedia({ url: "https://example.com/e/12", title: "Episode 12: Compilers", linkTags: ["AUDIO"] })?.type ===
      "podcast"
  )
  check(
    "AUDIO tagged as music is not a podcast",
    classifyMedia({
      url: "https://example.com/e/12",
      title: "Episode 12",
      linkTags: ["AUDIO"],
      contentTags: ["MUSIC"],
    }) === null
  )
  check(
    "a GAME topic tag alone doesn't make a game",
    classifyMedia({ url: "https://example.com/games-industry-layoffs", contentTags: ["GAME"] }) === null
  )

  console.log("One entry per item")
  check("YouTube id from youtu.be", youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?si=abc") === "dQw4w9WgXcQ")
  check("YouTube id from shorts", youtubeVideoId("https://www.youtube.com/shorts/abcdefghijk") === "abcdefghijk")
  check("no YouTube id for a channel", youtubeVideoId("https://www.youtube.com/@veritasium") === null)
  check(
    "the same video in two URL shapes has one key",
    mediaKey({ url: "https://youtu.be/dQw4w9WgXcQ?si=abc" }) ===
      mediaKey({ url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s" })
  )
  check(
    "the same Amazon book under two slugs has one key",
    mediaKey({ url: "https://www.amazon.com/Hobbit-J-R-R-Tolkien/dp/054792822X/ref=sr_1_1?tag=x-20" }) ===
      mediaKey({ url: "https://www.amazon.com/dp/054792822X" })
  )
  check(
    "tracking parameters don't split an item",
    mediaKey({ url: "https://open.spotify.com/episode/abc?si=123&utm_source=copy" }) ===
      mediaKey({ url: "https://open.spotify.com/episode/abc" })
  )
  check(
    "different episodes stay separate",
    mediaKey({ url: "https://open.spotify.com/episode/abc" }) !== mediaKey({ url: "https://open.spotify.com/episode/xyz" })
  )

  console.log("Links found in posts")
  check("a YouTube video in a post is kept", !isSkippedNestedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"))
  check("a youtu.be link in a post is kept", !isSkippedNestedUrl("https://youtu.be/dQw4w9WgXcQ"))
  check("a TikTok video in a post is kept", !isSkippedNestedUrl("https://www.tiktok.com/@someone/video/7234567890123456789"))
  check("a YouTube channel in a post is still skipped", isSkippedNestedUrl("https://www.youtube.com/@veritasium"))
  check("a quoted tweet is still skipped", isSkippedNestedUrl("https://x.com/someone/status/1234567890"))
  check("an Instagram photo post is still skipped", isSkippedNestedUrl("https://www.instagram.com/p/Cabc123/"))
  check("an ordinary article is kept", !isSkippedNestedUrl("https://example.com/an-article"))
}

async function lookupChecks() {
  const { urlsInText, videoCandidateUrl, videoLinksInHtml } = await import("../lib/media-lookup")
  const { priceSearches } = await import("../lib/ai-pricing")

  console.log("Search fee")
  const fee = (requests: number, usedThisMonth: number, model = "gemini-3.8-flash") =>
    priceSearches({ model, requests, usedThisMonth })
  const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-9
  check("searches inside the month's free allowance cost nothing", fee(6, 0) === 0 && fee(6, 4994) === 0)
  check("past the allowance each search is billed", near(fee(6, 5000), 0.084), fee(6, 5000))
  check("a call that crosses the allowance pays for the part past it", near(fee(6, 4997), 0.042), fee(6, 4997))
  check("a call with no searches has no fee, whatever the model", fee(0, 9000) === 0 && fee(0, 0, "some-other-model") === 0)
  check("a versioned model name is priced the same", near(fee(1, 5000, "gemini-3.8-flash-001"), 0.014))
  check("searches on a model with no known search price are unpriced", fee(3, 0, "some-other-model") === null)

  console.log("Video lookup candidates")
  check(
    "URLs are read out of the search answer without trailing punctuation",
    urlsInText("It is this talk (https://www.youtube.com/watch?v=RUMgK0TyV1Q). Clip: https://youtu.be/iDWHEeXQ9WI.").join() ===
      "https://www.youtube.com/watch?v=RUMgK0TyV1Q,https://youtu.be/iDWHEeXQ9WI"
  )
  check(
    "a watch URL is reduced to the video",
    videoCandidateUrl("https://youtu.be/RUMgK0TyV1Q?si=abc&t=120") === "https://www.youtube.com/watch?v=RUMgK0TyV1Q"
  )
  check(
    "an embedded player is the same video",
    videoCandidateUrl("https://www.youtube.com/embed/RUMgK0TyV1Q?feature=oembed") === "https://www.youtube.com/watch?v=RUMgK0TyV1Q"
  )
  check("a short stays a short", videoCandidateUrl("https://youtube.com/shorts/iDWHEeXQ9WI?feature=share") === "https://www.youtube.com/shorts/iDWHEeXQ9WI")
  check("a playlist is not one video", videoCandidateUrl("https://www.youtube.com/playlist?list=PL123") === null)
  check("a channel is not a video", videoCandidateUrl("https://www.youtube.com/@veritasium") === null)
  check("an article is not a video", videoCandidateUrl("https://example.com/an-article") === null)
  check("a site that can't confirm the video is left out", videoCandidateUrl("https://www.ted.com/talks/some_talk") === null)

  const page = `<html><head><title>Peter Thiel on how to think about the future</title></head><body>
    <p>He said it in 2014. <a href="https://www.youtube.com/watch?v=RUMgK0TyV1Q&t=30s">Full video</a></p>
    <a href="/about">About</a> <a href="https://www.youtube.com/@startuparchive">Our channel</a>
    <iframe src="https://www.youtube.com/embed/iDWHEeXQ9WI"></iframe>
    <a href="https://youtu.be/RUMgK0TyV1Q">again</a></body></html>`
  const links = videoLinksInHtml(page, "https://www.startuparchive.org/p/thiel")
  check(
    "video links and embedded players are found on a result page, once each",
    links.map((l) => l.url).join() === "https://www.youtube.com/watch?v=RUMgK0TyV1Q,https://www.youtube.com/watch?v=iDWHEeXQ9WI",
    links
  )
  check(
    "each says where it was found",
    links[0]?.foundOn === 'the link "Full video" on the page "Peter Thiel on how to think about the future"',
    links[0]?.foundOn
  )
}

async function postVideoChecks() {
  const { prisma } = await import("../lib/prisma")
  const { listMedia } = await import("../lib/media-list")
  const { processNestedLinks } = await import("../lib/process-nested-links")
  const { countPendingLookups, rejectFoundLink } = await import("../lib/media-lookup")
  const { DEFAULT_SETTINGS } = await import("../lib/settings")

  console.log("Posts with an uploaded video")
  const email = "carol-media@example.com"
  await prisma.user.deleteMany({ where: { email } })
  const carol = await prisma.user.create({ data: { email } })

  try {
    const context = { ...parsePostContext(QUOTING_POST)!, quoted: { ...parsePostContext(QUOTING_POST)!.quoted!, urls: [] } }
    const post = await prisma.link.create({
      data: {
        userId: carol.id,
        url: "https://x.com/rishabmishraa/status/2106565003608502767",
        urlHash: "carol-post",
        domain: "x.com",
        title: "I know about 5 people from my class",
        fetchStatus: "PAYWALL_DETECTED",
        postContext: context,
      },
    })

    // The stored context is used as is: no request to X, and no AI with lookup off
    await processNestedLinks(
      { ...post, emailId: null, finalUrl: null, rawHtml: null, finalDomain: null },
      DEFAULT_SETTINGS,
      { triggerAi: false, lookup: false }
    )
    const flagged = await prisma.link.findUnique({ where: { id: post.id }, select: { lookupStatus: true } })
    check("a post quoting an uploaded video waits for a lookup", flagged?.lookupStatus === "PENDING", flagged)
    check("it is counted as waiting", (await countPendingLookups(carol.id)) === 1)

    let media = await listMedia(carol.id)
    check(
      "until a source is known the post itself is the video",
      media.counts.video === 1 && media.items[0]?.via === "POST_VIDEO" && media.items[0].lookup?.status === "PENDING" && media.items[0].lookup.postId === post.id,
      media.items
    )
    check("with the clip's still image", media.items[0]?.imageUrl === "https://pbs.twimg.com/amplify_video_thumb/1/img/poster.jpg", media.items[0]?.imageUrl)

    // What a successful lookup leaves behind
    const found = (role: string, url: string, title: string) =>
      prisma.link.create({
        data: { userId: carol.id, parentLinkId: post.id, url, urlHash: `carol-${role}`, domain: "www.youtube.com", title, foundVia: "AI_LOOKUP", foundRole: role },
      })
    const full = await found("FULL", "https://www.youtube.com/watch?v=RUMgK0TyV1Q", "From Zero to One - Peter Thiel")
    const clip = await found("CLIP", "https://www.youtube.com/shorts/iDWHEeXQ9WI", "Peter Thiel on resumes")
    await prisma.link.update({ where: { id: post.id }, data: { lookupStatus: "FOUND", lookupNote: "Peter Thiel's 2014 talk at UT Austin." } })

    media = await listMedia(carol.id)
    const entry = media.items[0]
    check("the full recording and its clip are one entry", media.counts.video === 1 && media.items.length === 1, media.items)
    check("led by the full recording", entry?.id === full.id && entry.via === "AI_LOOKUP" && entry.role === "FULL", entry)
    check("with the short clip alongside", entry?.alternate?.id === clip.id && entry.alternate.url.includes("/shorts/"), entry?.alternate)
    check("and the post it was found for", entry?.post?.id === post.id && entry.lookup?.postId === post.id && entry.lookup.note?.includes("2014") === true, entry)
    check("searching for the clip's title finds the entry", (await listMedia(carol.id, { search: "resumes" })).items[0]?.id === full.id)

    await processNestedLinks(
      { ...post, emailId: null, finalUrl: null, rawHtml: null, finalDomain: null },
      DEFAULT_SETTINGS,
      { triggerAi: false, lookup: false }
    )
    const again = await prisma.link.findUnique({ where: { id: post.id }, select: { lookupStatus: true } })
    check("processing the post again keeps what was found", again?.lookupStatus === "FOUND", again)

    // An episode and a book found for the same post are entries of their own
    const episode = await prisma.link.create({
      data: { userId: carol.id, parentLinkId: post.id, url: "https://podcasts.apple.com/us/podcast/zero-to-one/id1?i=2", urlHash: "carol-episode", domain: "podcasts.apple.com", title: "Peter Thiel on Zero to One", foundVia: "AI_LOOKUP", foundRole: "EPISODE" },
    })
    const book = await prisma.link.create({
      data: { userId: carol.id, parentLinkId: post.id, url: "https://openlibrary.org/works/OL7W", urlHash: "carol-book", domain: "openlibrary.org", title: "Zero to One", foundVia: "AI_LOOKUP", foundRole: "BOOK" },
    })
    media = await listMedia(carol.id)
    check("a found episode is listed under podcasts and a found book under books", media.counts.video === 1 && media.counts.podcast === 1 && media.counts.book === 1, media.counts)
    check(
      "each says what it was found as",
      media.items.find((i) => i.id === episode.id)?.role === "EPISODE" && media.items.find((i) => i.id === book.id)?.role === "BOOK",
      media.items.map((i) => [i.title, i.role])
    )

    check("another user can't reject a found link", (await rejectFoundLink(book.id, "someone-else")) === false)
    check("a link that wasn't found by the lookup can't be rejected", (await rejectFoundLink(post.id, carol.id)) === false)
    check("'wrong book' is accepted", await rejectFoundLink(book.id, carol.id))
    let afterReject = await prisma.link.findUnique({ where: { id: post.id }, select: { lookupStatus: true, lookupRejected: true } })
    check(
      "it removes only the book, and remembers it",
      (await listMedia(carol.id)).counts.book === 0 && (await listMedia(carol.id)).counts.video === 1 && afterReject?.lookupStatus === "FOUND" && afterReject.lookupRejected.join() === "openlibrary.org/works/OL7W",
      afterReject
    )

    check("'wrong video' on the clip is accepted", await rejectFoundLink(clip.id, carol.id))
    media = await listMedia(carol.id)
    check(
      "it removes the clip and the full recording together, and the post is listed as itself again",
      media.counts.video === 1 && media.items.some((i) => i.id === post.id && i.via === "POST_VIDEO") && !media.items.some((i) => i.id === full.id),
      media.items.map((i) => [i.title, i.via])
    )
    check("'wrong episode' is accepted", await rejectFoundLink(episode.id, carol.id))
    afterReject = await prisma.link.findUnique({ where: { id: post.id }, select: { lookupStatus: true, lookupRejected: true } })
    check(
      "with nothing found left, the post is marked rejected and everything wrong is remembered",
      afterReject?.lookupStatus === "REJECTED" && afterReject.lookupRejected.includes("youtube:RUMgK0TyV1Q") && afterReject.lookupRejected.includes("youtube:iDWHEeXQ9WI") && afterReject.lookupRejected.length === 4,
      afterReject
    )
    check("a rejected post is not looked up again on its own", (await countPendingLookups(carol.id)) === 0)

    // A post whose own link already is the video
    const linked = await prisma.link.create({
      data: {
        userId: carol.id,
        url: "https://x.com/someone/status/42",
        urlHash: "carol-linked-post",
        domain: "x.com",
        title: "Full talk below",
        postContext: { ...parsePostContext({ id_str: "42", text: "Full talk below", mediaDetails: [{ type: "video" }] })! },
      },
    })
    await prisma.link.create({
      data: { userId: carol.id, parentLinkId: linked.id, url: "https://www.youtube.com/watch?v=aaaaaaaaaaa", urlHash: "carol-linked-video", domain: "www.youtube.com", title: "The talk" },
    })
    await processNestedLinks(
      { ...linked, emailId: null, finalUrl: null, rawHtml: null, finalDomain: null },
      DEFAULT_SETTINGS,
      { triggerAi: false, lookup: false }
    )
    const notFlagged = await prisma.link.findUnique({ where: { id: linked.id }, select: { lookupStatus: true } })
    check("a post that links its video needs no lookup", notFlagged?.lookupStatus === null, notFlagged)
    media = await listMedia(carol.id)
    // A post that links its video but also names a book still gets a lookup, for the book
    const bookPost = await prisma.link.create({
      data: {
        userId: carol.id,
        url: "https://x.com/someone/status/43",
        urlHash: "carol-book-post",
        domain: "x.com",
        title: "Just finished reading Dune, and this talk about it is great",
        postContext: { ...parsePostContext({ id_str: "43", text: "Just finished reading Dune, and this talk about it is great" })! },
      },
    })
    await prisma.link.create({
      data: { userId: carol.id, parentLinkId: bookPost.id, url: "https://www.youtube.com/watch?v=bbbbbbbbbbb", urlHash: "carol-book-post-video", domain: "www.youtube.com", title: "A talk about Dune" },
    })
    await processNestedLinks(
      { ...bookPost, emailId: null, finalUrl: null, rawHtml: null, finalDomain: null },
      DEFAULT_SETTINGS,
      { triggerAi: false, lookup: false }
    )
    const bookFlag = await prisma.link.findUnique({ where: { id: bookPost.id }, select: { lookupStatus: true } })
    check("a post that names a book waits for a lookup even though it links its video", bookFlag?.lookupStatus === "PENDING", bookFlag)

    // Books named by a page's analysis
    const { persistLinkAnalysis, mentionedBooksFromAnalysis } = await import("../lib/analysis")
    const { readMentionedBooks, mergeBooks } = await import("../lib/media-lookup")
    const article = await prisma.link.create({
      data: { userId: carol.id, url: "https://example.com/five-books", urlHash: "carol-article", domain: "example.com", title: "Five books on physics", fetchStatus: "FETCHED" },
    })
    const analysis = {
      summary: "A reading list.",
      tags: ["ARTICLE"],
      books: [
        { title: "The Making of the Atomic Bomb", author: "Richard Rhodes" },
        { title: " the making of the atomic bomb ", author: null },
        { title: "", author: "Nobody" },
        { title: "Surely You're Joking, Mr. Feynman!", author: null },
      ],
    }
    check("the analysis's books are cleaned up: titled, once each", mentionedBooksFromAnalysis(analysis).length === 2, mentionedBooksFromAnalysis(analysis))
    await persistLinkAnalysis(article.id, carol.id, analysis)
    let stored = await prisma.link.findUnique({ where: { id: article.id }, select: { mentionedBooks: true, lookupStatus: true } })
    check("a page whose analysis names books stores them and waits for a lookup", readMentionedBooks(stored?.mentionedBooks).length === 2 && stored?.lookupStatus === "PENDING", stored)

    await prisma.link.update({ where: { id: article.id }, data: { lookupStatus: "FOUND" } })
    await persistLinkAnalysis(article.id, carol.id, analysis)
    stored = await prisma.link.findUnique({ where: { id: article.id }, select: { mentionedBooks: true, lookupStatus: true } })
    check("analyzing a page again queues it again", stored?.lookupStatus === "PENDING", stored)

    await persistLinkAnalysis(article.id, carol.id, { summary: "No books this time.", tags: ["ARTICLE"], books: [] })
    stored = await prisma.link.findUnique({ where: { id: article.id }, select: { mentionedBooks: true, lookupStatus: true } })
    check("an analysis naming no books clears them", stored?.mentionedBooks === null, stored)

    await prisma.link.update({ where: { id: post.id }, data: { lookupStatus: "REJECTED" } })
    await persistLinkAnalysis(post.id, carol.id, analysis)
    const postAfter = await prisma.link.findUnique({ where: { id: post.id }, select: { lookupStatus: true } })
    check("analyzing a post doesn't restart a lookup that would search again", postAfter?.lookupStatus === "REJECTED", postAfter)

    check(
      "books named by the post and by its analysis are one list",
      mergeBooks([{ title: "Dune", author: null }], [{ title: "dune", author: "Frank Herbert" }, { title: "Emma" }]).map((b) => `${b.title}/${b.author}`).join() === "Dune/Frank Herbert,Emma/null"
    )
    check("stored books that aren't books are ignored", readMentionedBooks([{ title: "Dune" }, { author: "x" }, "y", null]).length === 1 && readMentionedBooks("nope").length === 0)

    // Podcast episodes wait for their show notes; what the notes link does not
    const { createFoundLink, awaitsShowNotes } = await import("../lib/nested-link")
    const emailedEpisode = await prisma.link.create({
      data: { userId: carol.id, url: "https://podcasts.apple.com/us/podcast/costco/id1050462261?i=1000625088063", urlHash: "carol-emailed-episode", domain: "podcasts.apple.com", title: "Costco", fetchStatus: "FETCHED" },
    })
    await processNestedLinks(
      { ...emailedEpisode, emailId: null, finalUrl: null, rawHtml: null, finalDomain: null },
      DEFAULT_SETTINGS,
      { triggerAi: false, lookup: false }
    )
    const episodeFlag = await prisma.link.findUnique({ where: { id: emailedEpisode.id }, select: { lookupStatus: true } })
    check("an emailed podcast episode waits for a lookup of its show notes", episodeFlag?.lookupStatus === "PENDING", episodeFlag)

    const foundEpisode = await createFoundLink(
      { id: bookPost.id, userId: carol.id, emailId: null },
      { url: "https://podcasts.apple.com/us/podcast/nike/id1050462261?i=1000600000001", title: "Nike", description: "Acquired", imageUrl: null },
      { foundVia: "AI_LOOKUP", foundRole: "EPISODE" }
    )
    const foundEpisodeRow = await prisma.link.findUnique({ where: { id: foundEpisode.linkId! }, select: { lookupStatus: true, contentSource: true } })
    check("so does an episode the lookup found", foundEpisodeRow?.lookupStatus === "PENDING" && foundEpisodeRow.contentSource === "catalog", foundEpisodeRow)

    const noteVideo = await createFoundLink(
      { id: foundEpisode.linkId!, userId: carol.id, emailId: null },
      { url: "https://www.youtube.com/watch?v=Z1sTs8wkAbw", title: "Warren Buffett's Costco joke", description: "From the show notes of Nike (Acquired)", imageUrl: null },
      { foundVia: "SHOW_NOTES" },
      "show_notes"
    )
    const noteEpisode = await createFoundLink(
      { id: foundEpisode.linkId!, userId: carol.id, emailId: null },
      { url: "https://podcasts.apple.com/us/podcast/other/id99?i=1000600000002", title: "Another show's episode", description: null, imageUrl: null },
      { foundVia: "SHOW_NOTES" },
      "show_notes"
    )
    const noteEpisodeRow = await prisma.link.findUnique({ where: { id: noteEpisode.linkId! }, select: { lookupStatus: true, contentSource: true } })
    check("an episode linked from show notes is not followed in turn", noteEpisodeRow?.lookupStatus === null && noteEpisodeRow.contentSource === "show_notes", noteEpisodeRow)
    check(
      "only podcast links that didn't come from show notes wait for them",
      awaitsShowNotes("https://open.spotify.com/episode/abc", {}) && !awaitsShowNotes("https://example.com/article", {}) && !awaitsShowNotes("https://open.spotify.com/episode/abc", { foundVia: "SHOW_NOTES" })
    )
    const duplicate = await createFoundLink(
      { id: foundEpisode.linkId!, userId: carol.id, emailId: null },
      { url: "https://www.youtube.com/watch?v=Z1sTs8wkAbw", title: "dup", description: null, imageUrl: null },
      { foundVia: "SHOW_NOTES" },
      "show_notes"
    )
    check("a link the user already has is not added twice", duplicate.skipped && duplicate.linkId === noteVideo.linkId, duplicate)

    media = await listMedia(carol.id)
    const fromNotes = media.items.find((i) => i.id === noteVideo.linkId)
    check(
      "a video from show notes is listed, pointing at the episode and opening the post it belongs to",
      fromNotes?.type === "video" && fromNotes.via === "SHOW_NOTES" && fromNotes.post?.title === "Nike" && fromNotes.feedLinkId === bookPost.id && fromNotes.lookup === null,
      fromNotes
    )

    check(
      "and is listed once, as the linked video",
      media.items.filter((i) => i.title === "The talk").length === 1 && !media.items.some((i) => i.id === linked.id),
      media.items.map((i) => i.title)
    )
  } finally {
    await prisma.user.deleteMany({ where: { email } })
  }
}

async function usageChecks() {
  const { prisma } = await import("../lib/prisma")
  const { recordAiUsage, searchesThisMonth, searchMonthStart } = await import("../lib/ai-usage")

  console.log("Recording searches")
  const email = "dave-media@example.com"
  await prisma.user.deleteMany({ where: { email } })
  const dave = await prisma.user.create({ data: { email } })
  try {
    const usage = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 300 }
    const call = (searchRequests?: number) =>
      recordAiUsage([{ userId: dave.id, kind: "MEDIA_LOOKUP", model: "gemini-3.8-flash", usage, searchRequests }])
    const last = () => prisma.aiUsage.findFirst({ where: { userId: dave.id }, orderBy: { createdAt: "desc" } })
    const near = (a: number | null | undefined, b: number) => typeof a === "number" && Math.abs(a - b) < 1e-9

    await call()
    const tokensOnly = (await last())!.costUsd!
    check("a call without searches costs its tokens", tokensOnly > 0 && (await last())!.searchRequests === 0)

    await call(6)
    const free = await last()
    check("searches are recorded on the call", free?.searchRequests === 6 && (await searchesThisMonth(dave.id)) === 6, free)
    check("and are free inside the allowance", near(free?.costUsd, tokensOnly), free?.costUsd)

    // Most of the month's allowance already used, and last month's use doesn't count
    await prisma.aiUsage.create({
      data: { userId: dave.id, kind: "MEDIA_LOOKUP", model: "gemini-3.8-flash", inputTokens: 0, outputTokens: 0, searchRequests: 4990 },
    })
    await prisma.aiUsage.create({
      data: { userId: dave.id, kind: "MEDIA_LOOKUP", model: "gemini-3.8-flash", inputTokens: 0, outputTokens: 0, searchRequests: 9000, createdAt: new Date(searchMonthStart().getTime() - 1000) },
    })
    await call(6)
    check("the call that crosses the allowance pays for 2 of its 6 searches", near((await last())?.costUsd, tokensOnly + 0.028), (await last())?.costUsd)
    await call(6)
    check("after that every search is billed", near((await last())?.costUsd, tokensOnly + 0.084), (await last())?.costUsd)

    // Two search calls recorded together share one running count
    await prisma.aiUsage.deleteMany({ where: { userId: dave.id } })
    await prisma.aiUsage.create({
      data: { userId: dave.id, kind: "MEDIA_LOOKUP", model: "gemini-3.8-flash", inputTokens: 0, outputTokens: 0, searchRequests: 4999 },
    })
    await recordAiUsage([
      { userId: dave.id, kind: "MEDIA_LOOKUP", model: "gemini-3.8-flash", usage, searchRequests: 1 },
      { userId: dave.id, kind: "MEDIA_LOOKUP", model: "gemini-3.8-flash", usage, searchRequests: 1 },
    ])
    const pair = await prisma.aiUsage.findMany({ where: { userId: dave.id, inputTokens: { gt: 0 } }, select: { costUsd: true } })
    const costs = pair.map((row) => row.costUsd ?? 0).sort()
    check("calls recorded together use up the allowance in order", near(costs[0], tokensOnly) && near(costs[1], tokensOnly + 0.014), costs)
  } finally {
    await prisma.user.deleteMany({ where: { email } })
  }
}

async function listChecks() {
  const { prisma } = await import("../lib/prisma")
  const { listMedia } = await import("../lib/media-list")
  const { rescanForMedia } = await import("../lib/media-rescan")
  const { DEFAULT_SETTINGS } = await import("../lib/settings")

  console.log("Media list")
  const emails = ["alice-media@example.com", "bob-media@example.com"]
  await prisma.user.deleteMany({ where: { email: { in: emails } } })
  const alice = await prisma.user.create({ data: { email: emails[0] } })
  const bob = await prisma.user.create({ data: { email: emails[1] } })

  try {
    const email = await prisma.email.create({
      data: { userId: alice.id, gmailId: "media-1", receivedAt: new Date("2026-03-01T12:00:00Z") },
    })
    const olderEmail = await prisma.email.create({
      data: { userId: alice.id, gmailId: "media-2", receivedAt: new Date("2026-01-15T12:00:00Z") },
    })

    let n = 0
    const mk = (userId: string, url: string, data: Record<string, unknown> = {}) =>
      prisma.link.create({
        data: { userId, url, urlHash: `media-test-${n++}`, domain: new URL(url).hostname, ...data },
      })

    const tweet = await mk(alice.id, "https://x.com/someone/status/1", {
      emailId: email.id,
      title: "You have to watch this",
      fetchStatus: "PAYWALL_DETECTED",
    })
    const nestedVideo = await mk(alice.id, "https://youtu.be/dQw4w9WgXcQ?si=abc", {
      emailId: email.id,
      parentLinkId: tweet.id,
      title: "A Great Video",
    })
    await mk(alice.id, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", { emailId: olderEmail.id })
    await mk(alice.id, "https://www.youtube.com/@veritasium", { emailId: email.id, title: "A channel" })
    await mk(alice.id, "https://open.spotify.com/episode/abc", { emailId: olderEmail.id, title: "Compilers, part 1" })
    await mk(alice.id, "https://amzn.to/3abcdef", {
      emailId: olderEmail.id,
      finalUrl: "https://www.amazon.com/Hobbit-J-R-R-Tolkien/dp/054792822X",
      finalDomain: "www.amazon.com",
      title: "The Hobbit",
    })
    await mk(alice.id, "https://store.steampowered.com/app/1145360/Hades/", { emailId: email.id, title: "Hades" })
    await mk(alice.id, "https://some-studio.example/our-game", {
      emailId: email.id,
      title: "Our Game",
      linkTags: ["GAME"],
    })
    await mk(alice.id, "https://example.com/an-article", {
      emailId: email.id,
      title: "An article",
      linkTags: ["ARTICLE"],
      contentTags: ["GAME"],
    })
    await mk(alice.id, "https://vimeo.com/123456789", { emailId: email.id, title: "Hidden video" })
    await mk(bob.id, "https://www.youtube.com/watch?v=bobsvideo01", { title: "Bob's video" })

    const all = await listMedia(alice.id, { hiddenDomains: ["vimeo.com"] })
    check(
      "counts per type",
      all.counts.all === 5 && all.counts.video === 1 && all.counts.podcast === 1 && all.counts.book === 1 && all.counts.game === 2,
      all.counts
    )
    check("no ordinary article, channel page, hidden domain or other user's link", !all.items.some((i) =>
      ["An article", "A channel", "Hidden video", "Bob's video"].includes(i.title ?? "")
    ), all.items.map((i) => i.title))

    const video = all.items.find((i) => i.type === "video")
    check("the same video shared twice is one entry", video?.duplicates === 1, video)
    check("the video found in a post points back to the post", video?.id === nestedVideo.id && video?.post?.id === tweet.id && video?.feedLinkId === tweet.id, video)
    check("a video without a stored image gets its YouTube thumbnail", video?.imageUrl === "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg", video?.imageUrl)

    const book = all.items.find((i) => i.type === "book")
    check("a shortened link is listed by its destination", book?.url.includes("amazon.com") === true && book?.source === "url", book)
    check("an AI-tagged game is marked as such", all.items.find((i) => i.title === "Our Game")?.source === "ai")

    const dates = all.items.map((i) => i.sharedAt)
    check("newest first, by when the email arrived", [...dates].sort().reverse().join() === dates.join(), dates)

    const games = await listMedia(alice.id, { type: "game" })
    check("filter by type", games.items.length === 2 && games.items.every((i) => i.type === "game") && games.pagination.total === 2, games.items)
    check("the type filter keeps every count", games.counts.video === 2 && games.counts.all === 6, games.counts)

    const searched = await listMedia(alice.id, { search: "hobbit" })
    check("search by title", searched.items.length === 1 && searched.items[0].type === "book", searched.items)

    const paged = await listMedia(alice.id, { limit: 2, page: 2 })
    check("pagination", paged.items.length === 2 && paged.pagination.totalPages === 3 && paged.pagination.total === 6, paged.pagination)

    const bobs = await listMedia(bob.id)
    check("Bob only sees his own", bobs.counts.all === 1 && bobs.items[0].title === "Bob's video", bobs.items)

    console.log("Rescan")
    // No post has stored HTML and no network is needed: only the cursor walk is checked here
    const rescan = await rescanForMedia(bob.id, null, DEFAULT_SETTINGS, { budgetMs: 2000 })
    check("a rescan with nothing to do finishes", rescan.done && rescan.cursor === null && rescan.linksFound === 0, rescan)
  } finally {
    await prisma.user.deleteMany({ where: { email: { in: emails } } })
  }
}

async function main() {
  ruleChecks()
  await lookupChecks()
  if (process.env.DATABASE_URL) {
    await listChecks()
    await postVideoChecks()
    await usageChecks()
  } else console.log("Media list: skipped (no DATABASE_URL)")

  console.log(failures === 0 ? "\nAll media checks passed" : `\n${failures} media check(s) failed`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
