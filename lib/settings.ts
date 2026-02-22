export interface UserSettings {
  ai?: {
    bamlClient?: string
    chatModel?: string
    embeddingModel?: string
    embeddingDimensions?: number
  }
  analysis?: {
    enabled?: boolean
    autoRun?: boolean
  }
  embeddings?: {
    enabled?: boolean
    autoRun?: boolean
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
    maxPagesLoadMore?: number
    maxPagesInitial?: number
  }
}

export interface ResolvedSettings {
  ai: {
    bamlClient: string
    chatModel: string
    embeddingModel: string
    embeddingDimensions: number
  }
  analysis: {
    enabled: boolean
    autoRun: boolean
  }
  embeddings: {
    enabled: boolean
    autoRun: boolean
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
    maxPagesLoadMore: number
    maxPagesInitial: number
  }
}

export const DEFAULT_SETTINGS: ResolvedSettings = {
  ai: {
    bamlClient: "CustomGemini",
    chatModel: "gemini-3-pro-preview",
    embeddingModel: "gemini-embedding-001",
    embeddingDimensions: 768,
  },
  analysis: {
    enabled: false,
    autoRun: false,
  },
  embeddings: {
    enabled: true,
    autoRun: true,
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
    maxPagesLoadMore: 5,
    maxPagesInitial: 5,
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
    analysis: {
      enabled: raw.analysis?.enabled ?? DEFAULT_SETTINGS.analysis.enabled,
      autoRun: raw.analysis?.autoRun ?? DEFAULT_SETTINGS.analysis.autoRun,
    },
    embeddings: {
      enabled: raw.embeddings?.enabled ?? DEFAULT_SETTINGS.embeddings.enabled,
      autoRun: raw.embeddings?.autoRun ?? DEFAULT_SETTINGS.embeddings.autoRun,
    },
    sync: {
      emailConcurrency: raw.sync?.emailConcurrency ?? DEFAULT_SETTINGS.sync.emailConcurrency,
      linkConcurrency: raw.sync?.linkConcurrency ?? DEFAULT_SETTINGS.sync.linkConcurrency,
      maxPagesLoadMore: raw.sync?.maxPagesLoadMore ?? DEFAULT_SETTINGS.sync.maxPagesLoadMore,
      maxPagesInitial: raw.sync?.maxPagesInitial ?? DEFAULT_SETTINGS.sync.maxPagesInitial,
    },
  }
}
