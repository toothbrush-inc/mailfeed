class LinkAnalysis {
  links Link[]
  tags LinkTag[]
  contentTags ContentTag[]
  metadataTags MetadataTags[]
  summary string @description("A short summary of the link's content.")
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
    Classify the type of link (article, video, image, audio, etc.).
    Classify the content category (technology, business, news, etc.).
    Identify any access restrictions (paywall, login required, etc.).
    Extract any other interesting links from the HTML.

    URL: {{ url }}
    Anchor Text: {{ anchorText }}
    Raw HTML: {{ rawHtml }}

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