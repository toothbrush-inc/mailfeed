// Gemini list prices in USD per 1M tokens, paid tier. Checked 2026-09-29 at
// https://ai.google.dev/gemini-api/docs/pricing — update when models or
// prices change. A model's rates are listed newest first; each applies from
// its `from` date (UTC), so costs recorded before a price change keep the
// price they ran at.
interface Rate {
  input: number
  output: number
  // Requests over LONG_CONTEXT_TOKENS input tokens, where a model charges more.
  longInput?: number
  longOutput?: number
}

const PRICES: Record<string, Array<{ from?: string; rate: Rate }>> = {
  "gemini-3.8-flash": [
    { from: "2027-01-01", rate: { input: 1.5, output: 7.5 } },
    { rate: { input: 0.75, output: 3.75 } },
  ],
  "gemini-3.7-flash": [
    { from: "2027-01-01", rate: { input: 1.5, output: 7.5 } },
    { rate: { input: 0.75, output: 3.75 } },
  ],
  "gemini-3.6-flash": [
    { from: "2027-01-01", rate: { input: 1.5, output: 7.5 } },
    { rate: { input: 0.75, output: 3.75 } },
  ],
  "gemini-3.1-pro-preview": [{ rate: { input: 2, output: 12, longInput: 4, longOutput: 18 } }],
  // No longer on the pricing page; $0.15 is its last listed price.
  "gemini-embedding-001": [{ rate: { input: 0.15, output: 0 } }],
}

export const LONG_CONTEXT_TOKENS = 200_000
export const BATCH_DISCOUNT = 0.5

function rateFor(model: string, at: Date): Rate | null {
  // Responses may report a versioned name (gemini-3.8-flash-001); match the
  // longest known prefix.
  const key = Object.keys(PRICES)
    .filter((k) => model === k || model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0]
  if (!key) return null
  const day = at.toISOString().slice(0, 10)
  return PRICES[key].find((p) => !p.from || p.from <= day)?.rate ?? null
}

export interface PricedCall {
  model: string
  inputTokens: number
  // Including thinking tokens, which are billed as output.
  outputTokens: number
  batch?: boolean
  at?: Date
}

/** Cost of one call in USD, or null when the model has no known price. */
export function priceCall({ model, inputTokens, outputTokens, batch = false, at = new Date() }: PricedCall): number | null {
  const rate = rateFor(model, at)
  if (!rate) return null
  const long = inputTokens > LONG_CONTEXT_TOKENS
  const cost =
    (inputTokens * (long && rate.longInput ? rate.longInput : rate.input) +
      outputTokens * (long && rate.longOutput ? rate.longOutput : rate.output)) /
    1_000_000
  return batch ? cost * BATCH_DISCOUNT : cost
}
