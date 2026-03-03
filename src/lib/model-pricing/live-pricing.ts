/**
 * Live pricing fetcher for external provider APIs.
 *
 * Fetches real-time pricing from OpenRouter and FAL,
 * caches results with a 2-day TTL.
 */

import { createScopedLogger } from '@/lib/logging/core'

const logger = createScopedLogger({ module: 'model-pricing.live' })

const CACHE_TTL_MS = 2 * 24 * 60 * 60 * 1000 // 2 days

export interface LivePricingEntry {
  provider: string
  modelId: string
  modelType: 'llm' | 'image' | 'video' | 'audio' | 'lipsync'
  inputPerMillion?: number
  outputPerMillion?: number
  perUnit?: number
  unit?: 'image' | 'second' | 'call'
  label: string
  source: 'openrouter' | 'fal'
}

interface CacheEntry {
  entries: LivePricingEntry[]
  fetchedAt: number
}

const cache = new Map<string, CacheEntry>()

function isCacheValid(key: string): boolean {
  const entry = cache.get(key)
  if (!entry) return false
  return Date.now() - entry.fetchedAt < CACHE_TTL_MS
}

// --- OpenRouter ---

interface OpenRouterModel {
  id: string
  name: string
  pricing: {
    prompt: string
    completion: string
    request: string
    image: string
  }
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
  }
}

function parseOpenRouterModelType(model: OpenRouterModel): 'llm' | 'image' | null {
  const outputs = model.architecture?.output_modalities || []
  if (outputs.includes('image')) return 'image'
  if (outputs.includes('text')) return 'llm'
  return 'llm'
}

function openRouterPerTokenToPerMillion(perToken: string): number {
  const n = parseFloat(perToken)
  if (!Number.isFinite(n) || n < 0) return 0
  return n * 1_000_000
}

async function fetchOpenRouterPricing(): Promise<LivePricingEntry[]> {
  const CACHE_KEY = 'openrouter'
  if (isCacheValid(CACHE_KEY)) {
    return cache.get(CACHE_KEY)!.entries
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      logger.warn({ action: 'openrouter.fetch_failed', message: `HTTP ${response.status}` })
      return cache.get(CACHE_KEY)?.entries || []
    }

    const data = await response.json() as { data?: OpenRouterModel[] }
    const models = data.data || []
    const entries: LivePricingEntry[] = []

    for (const model of models) {
      if (!model.pricing) continue
      const modelType = parseOpenRouterModelType(model)
      if (!modelType) continue

      const inputPerMillion = openRouterPerTokenToPerMillion(model.pricing.prompt)
      const outputPerMillion = openRouterPerTokenToPerMillion(model.pricing.completion)

      if (inputPerMillion === 0 && outputPerMillion === 0) continue

      const min = Math.min(inputPerMillion, outputPerMillion)
      const max = Math.max(inputPerMillion, outputPerMillion)

      entries.push({
        provider: 'openrouter',
        modelId: model.id,
        modelType,
        inputPerMillion,
        outputPerMillion,
        label: min === max
          ? formatAmount(min)
          : `${formatAmount(min)}~${formatAmount(max)}`,
        source: 'openrouter',
      })
    }

    cache.set(CACHE_KEY, { entries, fetchedAt: Date.now() })
    logger.info({ action: 'openrouter.fetched', message: `${entries.length} models` })
    return entries
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.warn({ action: 'openrouter.fetch_error', message: msg })
    return cache.get(CACHE_KEY)?.entries || []
  }
}

// --- FAL ---

interface FalPricingResponse {
  [endpointId: string]: {
    pricing_mode: string
    unit_price?: number
    unit?: string
    gpu_price?: number
  }
}

const FAL_MODEL_TYPE_MAP: Record<string, 'image' | 'video' | 'audio' | 'lipsync'> = {
  'fal-ai/seedream-v4': 'image',
  'fal-ai/flux-pro/kontext': 'image',
  'fal-ai/recraft-v3': 'image',
  'fal-ai/kling-video/v2.1/standard/text-to-video': 'video',
  'fal-ai/kling-video/v2.1/pro/text-to-video': 'video',
  'fal-ai/kling-video/v2.1/master/text-to-video': 'video',
  'fal-ai/kling-video/v2.5/turbo-pro/text-to-video': 'video',
  'fal-ai/kling-video/v2.5/turbo-pro/image-to-video': 'video',
  'fal-ai/kling-video/lipsync/audio-to-video': 'lipsync',
  'fal-ai/wan/v2.1/text-to-video': 'video',
  'fal-ai/wan/v2.1/image-to-video': 'video',
  'fal-ai/veo3': 'video',
}

async function fetchFalPricing(apiKey: string | null): Promise<LivePricingEntry[]> {
  const CACHE_KEY = 'fal'
  if (isCacheValid(CACHE_KEY)) {
    return cache.get(CACHE_KEY)!.entries
  }
  if (!apiKey) return []

  const endpointIds = Object.keys(FAL_MODEL_TYPE_MAP)
  const queryParams = endpointIds.map((id) => `endpoint_ids=${encodeURIComponent(id)}`).join('&')

  try {
    const response = await fetch(`https://api.fal.ai/v1/models/pricing?${queryParams}`, {
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      logger.warn({ action: 'fal.fetch_failed', message: `HTTP ${response.status}` })
      return cache.get(CACHE_KEY)?.entries || []
    }

    const data = await response.json() as FalPricingResponse
    const entries: LivePricingEntry[] = []

    for (const [endpointId, info] of Object.entries(data)) {
      const modelType = FAL_MODEL_TYPE_MAP[endpointId]
      if (!modelType) continue

      const unitPrice = info.unit_price
      if (typeof unitPrice !== 'number' || !Number.isFinite(unitPrice)) continue

      const unit = info.unit === 'second' ? 'second' as const
        : info.unit === 'image' ? 'image' as const
        : 'call' as const

      entries.push({
        provider: 'fal',
        modelId: endpointId,
        modelType,
        perUnit: unitPrice,
        unit,
        label: formatAmount(unitPrice),
        source: 'fal',
      })
    }

    cache.set(CACHE_KEY, { entries, fetchedAt: Date.now() })
    logger.info({ action: 'fal.fetched', message: `${entries.length} models` })
    return entries
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.warn({ action: 'fal.fetch_error', message: msg })
    return cache.get(CACHE_KEY)?.entries || []
  }
}

// --- Utilities ---

function formatAmount(amount: number): string {
  const fixed = amount.toFixed(4)
  const normalized = fixed.replace(/\.?0+$/, '')
  return normalized || '0'
}

// --- Public API ---

export interface FetchLivePricingOptions {
  falApiKey?: string | null
}

export async function fetchAllLivePricing(
  options: FetchLivePricingOptions = {},
): Promise<LivePricingEntry[]> {
  const [openRouterEntries, falEntries] = await Promise.all([
    fetchOpenRouterPricing(),
    fetchFalPricing(options.falApiKey || null),
  ])

  return [...openRouterEntries, ...falEntries]
}

export function buildLivePricingDisplayKey(
  modelType: string,
  provider: string,
  modelId: string,
): string {
  return `${modelType}::${provider}::${modelId}`
}
