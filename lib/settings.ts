export interface UserSettings {
  ai?: {
    bamlClient?: string
    chatModel?: string
    embeddingModel?: string
    embeddingDimensions?: number
  }
  email?: {
    query?: string
  }
  fetching?: {
    fallbackChain?: string[]
    fetchTimeoutMs?: number
  }
  feed?: {
    pageSize?: number
    defaultSort?: string
  }
  sync?: {
    emailConcurrency?: number
    linkConcurrency?: number
    maxPagesNormal?: number
    maxPagesContinue?: number
    maxPagesFull?: number
  }
}

export interface ResolvedSettings {
  ai: {
    bamlClient: string
    chatModel: string
    embeddingModel: string
    embeddingDimensions: number
  }
  email: {
    query: string
  }
  fetching: {
    fallbackChain: string[]
    fetchTimeoutMs: number
  }
  feed: {
    pageSize: number
    defaultSort: string
  }
  sync: {
    emailConcurrency: number
    linkConcurrency: number
    maxPagesNormal: number
    maxPagesContinue: number
    maxPagesFull: number
  }
}

export const DEFAULT_SETTINGS: ResolvedSettings = {
  ai: {
    bamlClient: "CustomGemini",
    chatModel: "gemini-3-pro-preview",
    embeddingModel: "gemini-embedding-001",
    embeddingDimensions: 768,
  },
  email: {
    query: "from:me to:me",
  },
  fetching: {
    fallbackChain: ["direct", "wayback"],
    fetchTimeoutMs: 30000,
  },
  feed: {
    pageSize: 20,
    defaultSort: "date_desc",
  },
  sync: {
    emailConcurrency: 10,
    linkConcurrency: 5,
    maxPagesNormal: 1,
    maxPagesContinue: 5,
    maxPagesFull: 20,
  },
}

export function resolveSettings(raw: UserSettings | null | undefined): ResolvedSettings {
  if (!raw) return { ...DEFAULT_SETTINGS }

  return {
    ai: {
      bamlClient: raw.ai?.bamlClient ?? DEFAULT_SETTINGS.ai.bamlClient,
      chatModel: raw.ai?.chatModel ?? DEFAULT_SETTINGS.ai.chatModel,
      embeddingModel: raw.ai?.embeddingModel ?? DEFAULT_SETTINGS.ai.embeddingModel,
      embeddingDimensions: raw.ai?.embeddingDimensions ?? DEFAULT_SETTINGS.ai.embeddingDimensions,
    },
    email: {
      query: raw.email?.query ?? DEFAULT_SETTINGS.email.query,
    },
    fetching: {
      fallbackChain: raw.fetching?.fallbackChain ?? DEFAULT_SETTINGS.fetching.fallbackChain,
      fetchTimeoutMs: raw.fetching?.fetchTimeoutMs ?? DEFAULT_SETTINGS.fetching.fetchTimeoutMs,
    },
    feed: {
      pageSize: raw.feed?.pageSize ?? DEFAULT_SETTINGS.feed.pageSize,
      defaultSort: raw.feed?.defaultSort ?? DEFAULT_SETTINGS.feed.defaultSort,
    },
    sync: {
      emailConcurrency: raw.sync?.emailConcurrency ?? DEFAULT_SETTINGS.sync.emailConcurrency,
      linkConcurrency: raw.sync?.linkConcurrency ?? DEFAULT_SETTINGS.sync.linkConcurrency,
      maxPagesNormal: raw.sync?.maxPagesNormal ?? DEFAULT_SETTINGS.sync.maxPagesNormal,
      maxPagesContinue: raw.sync?.maxPagesContinue ?? DEFAULT_SETTINGS.sync.maxPagesContinue,
      maxPagesFull: raw.sync?.maxPagesFull ?? DEFAULT_SETTINGS.sync.maxPagesFull,
    },
  }
}
