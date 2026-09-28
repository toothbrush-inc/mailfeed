class LinkAnalysis {
  links Link[]
  tags LinkTag[]
  contentTags ContentTag[]
  metadataTags MetadataTags[]
  summary string @description("A short summary of the link's content.")
  keyPoints string[] @description("3 to 5 key points or takeaways from the content, each one short sentence. Empty if there is no substantive content.")
  worthReading int? @description(#"
    How worth a general curious reader's time this content is, from 1 to 5. Judge substance, originality, depth and practical value.
    5 = exceptional, a must-read. 4 = good, clearly worth reading. 3 = decent. 2 = below average, shallow or mostly unoriginal. 1 = thin, promotional or low value.
    Be calibrated and use the full range: most links should score 2 to 4, and 5 should be rare.
  "#)
  worthReason string? @description("One short sentence on why it is or isn't worth the reader's time.")
}

class Link {
  url string
  anchorText string
}

enum ContentTag {
  TECHNOLOGY
  BUSINESS
  SCIENCE
  HEALTH
  POLITICS
  CULTURE
  FINANCE
  SELF_IMPROVEMENT
  NEWS
  OPINION
  TUTORIAL
  RESEARCH
  FUN
  HISTORY
  ART
  MUSIC
  MOVIE
  TV
  GAME
  OTHER
  @@dynamic
}

enum LinkTag {
  ARTICLE
  VIDEO
  IMAGE
  AUDIO
  REAL_TIME_COMMUNICATION
  PHONE_NUMBER
  EMAIL_ADDRESS
}

enum MetadataTags {
    OPEN_ACCESS
    LOGIN_REQUIRED
    PAYMENT_REQUIRED
    SUBSCRIPTION_REQUIRED
    ADS
    SPAM
    SCAM
    ADULT_CONTENT
    OTHER
}

function IngestLink(url: string, anchorText: string, rawHtml: string?) -> LinkAnalysis {
  // Specify a client as provider/model-name
  // You can also use custom LLM params with a custom client name from clients.baml like "client CustomGPT5" or "client CustomSonnet4"
  client "CustomGemini" // Set OPENAI_API_KEY to use this client.
  prompt #"
    You are a content extraction and analysis agent. Analyze the provided HTML and extract meaningful content.

    For social media posts (Twitter/X, Reddit, LinkedIn, etc.), focus on:
    - The main post text/content
    - The author/username if visible
    - Any quoted or embedded content
    - Thread context if available

    For articles and blog posts, extract:
    - The main article text
    - Key points and summary

    For videos (YouTube, Vimeo, etc.), extract:
    - Video title and description
    - Channel/creator name

    Ignore navigation, ads, scripts, and boilerplate HTML. Focus on the actual content.

    Provide a clear, concise summary of what this content is about.
    List 3 to 5 key points a reader should take away. Only use what the content says; if you only have a teaser or a login page, return no key points.
    Classify the type of link (article, video, image, audio, etc.).
    Classify the content category (technology, business, news, etc.).
    Identify any access restrictions (paywall, login required, etc.).
    Extract any other interesting links from the HTML.
    Rate how worth reading it is (1 to 5) and say why in one short sentence.

    URL: {{ url }}
    Anchor Text: {{ anchorText }}
    Raw HTML: {{ rawHtml }}

    {{ ctx.output_format }}
  "#
}

class LinkInput {
  id string @description("Unique identifier for this link, used to match results back.")
  url string
  anchorText string
  rawHtml string? @description("Raw HTML content of the page, if available.")
}

class BulkLinkResult {
  id string @description("The id from the corresponding LinkInput.")
  analysis LinkAnalysis
}

function BulkIngestLinks(links: LinkInput[]) -> BulkLinkResult[] {
  client "CustomGemini"
  prompt #"
    You are a content extraction and analysis agent. You will be given multiple links to analyze in a single batch.

    For each link, analyze the provided HTML and extract meaningful content following these rules:

    For social media posts (Twitter/X, Reddit, LinkedIn, etc.), focus on:
    - The main post text/content
    - The author/username if visible
    - Any quoted or embedded content
    - Thread context if available

    For articles and blog posts, extract:
    - The main article text
    - Key points and summary

    For videos (YouTube, Vimeo, etc.), extract:
    - Video title and description
    - Channel/creator name

    Ignore navigation, ads, scripts, and boilerplate HTML. Focus on the actual content.

    For each link, provide:
    - A clear, concise summary of what the content is about
    - 3 to 5 key points a reader should take away (none if you only have a teaser or a login page)
    - The type of link (article, video, image, audio, etc.)
    - The content category (technology, business, news, etc.)
    - Any access restrictions (paywall, login required, etc.)
    - Any other interesting links extracted from the HTML
    - How worth reading it is (1 to 5) and why, in one short sentence

    IMPORTANT: Return one result per input link, using the same id from the input.

    Links to analyze:
    {% for link in links %}
    --- LINK {{ link.id }} ---
    URL: {{ link.url }}
    Anchor Text: {{ link.anchorText }}
    Raw HTML: {{ link.rawHtml }}

    {% endfor %}

    {{ ctx.output_format }}
  "#
}

test vaibhav_other_link {
  functions [IngestLink]
  args {
    url #"
      https://www.boundaryml.com
    "#
    anchorText #"
      BoundaryML
    "#
    rawHtml #"
      <html>
        <body>
          <h1>BoundaryML</h1>
          <p>BoundaryML is a company that makes software for AI.</p>
        </body>
      </html>
    "#
  }
}