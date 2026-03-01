/**
 * API config types and preset constants
 */
import {
    composeModelKey,
    parseModelKeyStrict,
    type ModelCapabilities,
    type UnifiedModelType,
} from '@/lib/model-config-contract'

// Unified provider interface
export interface Provider {
    id: string
    name: string
    baseUrl?: string
    apiKey?: string
    hasApiKey?: boolean
    apiMode?: 'gemini-sdk' | 'openai-official'
}

export interface LlmCustomPricing {
    inputPerMillion?: number
    outputPerMillion?: number
}

export interface MediaCustomPricing {
    basePrice?: number
    optionPrices?: Record<string, Record<string, number>>
}

// User pricing V2 (capability params)
export interface CustomModelPricing {
    llm?: LlmCustomPricing
    image?: MediaCustomPricing
    video?: MediaCustomPricing
}

// Model interface
export interface CustomModel {
    modelId: string       // Unique id (e.g. anthropic/claude-sonnet-4.5)
    modelKey: string      // Unique key (provider::modelId)
    name: string          // Display name
    type: UnifiedModelType
    provider: string
    price: number
    priceMin?: number
    priceMax?: number
    priceLabel?: string
    priceInput?: number
    priceOutput?: number
    enabled: boolean
    capabilities?: ModelCapabilities
    customPricing?: CustomModelPricing
}

export interface PricingDisplayItem {
    min: number
    max: number
    label: string
    input?: number
    output?: number
}

export type PricingDisplayMap = Record<string, PricingDisplayItem>

// API config response
export interface ApiConfig {
    models: CustomModel[]
    providers: Provider[]
    pricingDisplay?: PricingDisplayMap
}

type PresetModel = Omit<CustomModel, 'enabled' | 'modelKey' | 'price'>

// Preset models
export const PRESET_MODELS: PresetModel[] = [
    // Text models
    { modelId: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', type: 'llm', provider: 'openrouter' },
    { modelId: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', type: 'llm', provider: 'openrouter' },
    { modelId: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash', type: 'llm', provider: 'openrouter' },
    { modelId: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', type: 'llm', provider: 'openrouter' },
    { modelId: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', type: 'llm', provider: 'openrouter' },
    // Google AI Studio text models
    { modelId: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', type: 'llm', provider: 'google' },
    { modelId: 'gemini-3-pro-preview', name: 'Gemini 3 Pro', type: 'llm', provider: 'google' },
    { modelId: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', type: 'llm', provider: 'google' },
    // Volcengine Doubao text models
    { modelId: 'doubao-seed-1-8-251228', name: 'Doubao Seed 1.8', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-2-0-pro-260215', name: 'Doubao Seed 2.0 Pro', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-2-0-lite-260215', name: 'Doubao Seed 2.0 Lite', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-2-0-mini-260215', name: 'Doubao Seed 2.0 Mini', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-1-6-251015', name: 'Doubao Seed 1.6', type: 'llm', provider: 'ark' },
    { modelId: 'doubao-seed-1-6-lite-251015', name: 'Doubao Seed 1.6 Lite', type: 'llm', provider: 'ark' },

    // Image models
    { modelId: 'banana', name: 'Banana Pro', type: 'image', provider: 'fal' },
    { modelId: 'banana-2', name: 'Banana 2', type: 'image', provider: 'fal' },
    { modelId: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5', type: 'image', provider: 'ark' },
    { modelId: 'doubao-seedream-4-0-250828', name: 'Seedream 4.0', type: 'image', provider: 'ark' },
    { modelId: 'gemini-3-pro-image-preview', name: 'Banana Pro', type: 'image', provider: 'google' },
    { modelId: 'gemini-3.1-flash-image-preview', name: 'Nano Banana 2', type: 'image', provider: 'google' },
    { modelId: 'gemini-3-pro-image-preview-batch', name: 'Banana Pro (Batch)', type: 'image', provider: 'google' },
    { modelId: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', type: 'image', provider: 'google' },
    { modelId: 'imagen-4.0-generate-001', name: 'Imagen 4', type: 'image', provider: 'google' },
    { modelId: 'imagen-4.0-ultra-generate-001', name: 'Imagen 4 Ultra', type: 'image', provider: 'google' },
    { modelId: 'imagen-4.0-fast-generate-001', name: 'Imagen 4 Fast', type: 'image', provider: 'google' },
    // Video models
    { modelId: 'doubao-seedance-1-0-pro-fast-251015', name: 'Seedance 1.0 Pro Fast', type: 'video', provider: 'ark' },
    { modelId: 'doubao-seedance-1-0-lite-i2v-250428', name: 'Seedance 1.0 Lite', type: 'video', provider: 'ark' },
    { modelId: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro', type: 'video', provider: 'ark' },
    { modelId: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0（Coming soon）', type: 'video', provider: 'ark' },
    { modelId: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro', type: 'video', provider: 'ark' },
    // Google Veo
    { modelId: 'veo-3.1-generate-preview', name: 'Veo 3.1', type: 'video', provider: 'google' },
    { modelId: 'veo-3.1-fast-generate-preview', name: 'Veo 3.1 Fast', type: 'video', provider: 'google' },
    { modelId: 'veo-3.0-generate-001', name: 'Veo 3.0', type: 'video', provider: 'google' },
    { modelId: 'veo-3.0-fast-generate-001', name: 'Veo 3.0 Fast', type: 'video', provider: 'google' },
    { modelId: 'veo-2.0-generate-001', name: 'Veo 2.0', type: 'video', provider: 'google' },
    { modelId: 'fal-wan25', name: 'Wan 2.6', type: 'video', provider: 'fal' },
    { modelId: 'fal-veo31', name: 'Veo 3.1', type: 'video', provider: 'fal' },
    { modelId: 'fal-sora2', name: 'Sora 2', type: 'video', provider: 'fal' },
    { modelId: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', name: 'Kling 2.5 Turbo Pro', type: 'video', provider: 'fal' },
    { modelId: 'fal-ai/kling-video/v3/standard/image-to-video', name: 'Kling 3 Standard', type: 'video', provider: 'fal' },
    { modelId: 'fal-ai/kling-video/v3/pro/image-to-video', name: 'Kling 3 Pro', type: 'video', provider: 'fal' },

    // Audio models
    { modelId: 'fal-ai/index-tts-2/text-to-speech', name: 'IndexTTS 2', type: 'audio', provider: 'fal' },
    // Lip-sync models
    { modelId: 'fal-ai/kling-video/lipsync/audio-to-video', name: 'Kling Lip Sync', type: 'lipsync', provider: 'fal' },
    { modelId: 'vidu-lipsync', name: 'Vidu Lip Sync', type: 'lipsync', provider: 'vidu' },

    // MiniMax video models
    { modelId: 'minimax-hailuo-2.3', name: 'Hailuo 2.3', type: 'video', provider: 'minimax' },
    { modelId: 'minimax-hailuo-2.3-fast', name: 'Hailuo 2.3 Fast', type: 'video', provider: 'minimax' },
    { modelId: 'minimax-hailuo-02', name: 'Hailuo 02', type: 'video', provider: 'minimax' },
    { modelId: 't2v-01', name: 'T2V-01', type: 'video', provider: 'minimax' },
    { modelId: 't2v-01-director', name: 'T2V-01 Director', type: 'video', provider: 'minimax' },

    // Vidu video models
    { modelId: 'viduq3-pro', name: 'Vidu Q3 Pro', type: 'video', provider: 'vidu' },
    { modelId: 'viduq2-pro-fast', name: 'Vidu Q2 Pro Fast', type: 'video', provider: 'vidu' },
    { modelId: 'viduq2-pro', name: 'Vidu Q2 Pro', type: 'video', provider: 'vidu' },
    { modelId: 'viduq2-turbo', name: 'Vidu Q2 Turbo', type: 'video', provider: 'vidu' },
    { modelId: 'viduq1', name: 'Vidu Q1', type: 'video', provider: 'vidu' },
    { modelId: 'viduq1-classic', name: 'Vidu Q1 Classic', type: 'video', provider: 'vidu' },
    { modelId: 'vidu2.0', name: 'Vidu 2.0', type: 'video', provider: 'vidu' },
]

const PRESET_COMING_SOON_MODEL_KEYS = new Set<string>([
    encodeModelKey('ark', 'doubao-seedance-2-0-260128'),
])

export function isPresetComingSoonModel(provider: string, modelId: string): boolean {
    return PRESET_COMING_SOON_MODEL_KEYS.has(encodeModelKey(provider, modelId))
}

export function isPresetComingSoonModelKey(modelKey: string): boolean {
    return PRESET_COMING_SOON_MODEL_KEYS.has(modelKey)
}

// Preset providers (API Key belongs to provider id)
export const PRESET_PROVIDERS: Omit<Provider, 'apiKey' | 'hasApiKey'>[] = [
    { id: 'ark', name: 'Volcengine Ark' },
    { id: 'google', name: 'Google AI Studio' },
    { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
    { id: 'minimax', name: 'MiniMax Hailuo' },
    { id: 'vidu', name: 'Vidu' },
    { id: 'fal', name: 'FAL' },
    { id: 'qwen', name: 'Qwen' },
]

const ZH_PROVIDER_NAME_MAP: Record<string, string> = {
    ark: 'Volcengine Ark',
    minimax: 'MiniMax',
    vidu: 'Vidu',
}

function isZhLocale(locale?: string): boolean {
    return typeof locale === 'string' && locale.toLowerCase().startsWith('zh')
}

export function resolvePresetProviderName(providerId: string, fallbackName: string, locale?: string): string {
    if (!isZhLocale(locale)) return fallbackName
    return ZH_PROVIDER_NAME_MAP[providerId] ?? fallbackName
}

/**
 * Extract provider key (e.g. gemini-compatible:uuid)
 */
export function getProviderKey(providerId?: string): string {
    if (!providerId) return ''
    const colonIndex = providerId.indexOf(':')
    return colonIndex === -1 ? providerId : providerId.slice(0, colonIndex)
}

/**
 * Get provider display name
 * @param providerId - Provider id (e.g. ark, google)
 * @returns Display name
 */
export function getProviderDisplayName(providerId?: string, locale?: string): string {
    if (!providerId) return ''
    const providerKey = getProviderKey(providerId)
    const provider = PRESET_PROVIDERS.find(p => p.id === providerKey)
    if (!provider) return providerId
    return resolvePresetProviderName(provider.id, provider.name, locale)
}

/**
 * Encode model composite key
 * @param provider - Provider ID
 * @param modelId - Model ID
 * @returns Composite key provider::modelId
 */
export function encodeModelKey(provider: string, modelId: string): string {
    return composeModelKey(provider, modelId)
}

/**
 * Parse model composite key
 * @param key - Composite key
 * @returns { provider, modelId } or null
 */
export function parseModelKey(key: string | undefined | null): { provider: string, modelId: string } | null {
    const parsed = parseModelKeyStrict(key)
    if (!parsed) return null
    return {
        provider: parsed.provider,
        modelId: parsed.modelId,
    }
}

/**
 * Check if composite key matches model
 * @param key - Composite key
 * @param provider - Target provider ID
 * @param modelId - Target model ID
 * @returns Whether match
 */
export function matchesModelKey(key: string | undefined | null, provider: string, modelId: string): boolean {
    const parsed = parseModelKeyStrict(key)
    if (!parsed) return false
    return parsed.provider === provider && parsed.modelId === modelId
}

// Tutorial step interface
export interface TutorialStep {
    text: string           // Step description (i18n key)
    url?: string           // Optional URL
}

// Provider tutorial interface
export interface ProviderTutorial {
    providerId: string
    steps: TutorialStep[]
}

// Provider onboarding tutorial config
// Note: text is i18n key under apiConfig.tutorials
export const PROVIDER_TUTORIALS: ProviderTutorial[] = [
    {
        providerId: 'ark',
        steps: [
            {
                text: 'ark_step1',
                url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey?apikey=%7B%7D'
            },
            {
                text: 'ark_step2',
                url: 'https://console.volcengine.com/ark/region:ark+cn-beijing/openManagement?LLM=%7B%7D&advancedActiveKey=model'
            }
        ]
    },
    {
        providerId: 'openrouter',
        steps: [
            {
                text: 'openrouter_step1',
                url: 'https://openrouter.ai/settings/keys'
            }
        ]
    },
    {
        providerId: 'fal',
        steps: [
            {
                text: 'fal_step1',
                url: 'https://fal.ai/dashboard/keys'
            }
        ]
    },
    {
        providerId: 'google',
        steps: [
            {
                text: 'google_step1',
                url: 'https://aistudio.google.com/api-keys'
            }
        ]
    },
    {
        providerId: 'minimax',
        steps: [
            {
                text: 'minimax_step1',
                url: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
            }
        ]
    },
    {
        providerId: 'vidu',
        steps: [
            {
                text: 'vidu_step1',
                url: 'https://platform.vidu.cn/api-keys'
            }
        ]
    },
    {
        providerId: 'gemini-compatible',
        steps: [
            {
                text: 'gemini_compatible_step1'
            }
        ]
    },
    {
        providerId: 'openai-compatible',
        steps: [
            {
                text: 'openai_compatible_step1'
            }
        ]
    },
    {
        providerId: 'qwen',
        steps: [
            {
                text: 'qwen_step1',
                url: 'https://bailian.console.aliyun.com/cn-beijing/?tab=model#/api-key'
            }
        ]
    }
]

/**
 * Get tutorial config by provider ID
 * @param providerId - Provider ID
 * @returns Tutorial config or undefined
 */
export function getProviderTutorial(providerId: string): ProviderTutorial | undefined {
    const providerKey = getProviderKey(providerId)
    return PROVIDER_TUTORIALS.find(t => t.providerId === providerKey)
}

/**
 * Clone Google official model list, replace provider with given ID.
 * Used when adding gemini-compatible to preset models.
 * Exclude batch models (Google async batch).
 */
export function getGoogleCompatiblePresetModels(providerId: string): PresetModel[] {
    return PRESET_MODELS
        .filter((m) => m.provider === 'google' && !m.modelId.endsWith('-batch'))
        .map((m) => ({ ...m, provider: providerId }))
}
