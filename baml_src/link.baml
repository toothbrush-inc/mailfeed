class LinkAnalysis {
  links Link[]
  tags LinkTag[]
  contentTags ContentTag[]
  metadataTags MetadataTags[]
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
  REAL_TIME_CHAT
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
    You are a link analysis agent. Your task is to analyze the link and its content.
    Focus on classifying the type of link based on the content of the link.
    Also classify the link's metadata tags based on the content of the link.
    Extract any other links in the raw HTML as well.

    Link:
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