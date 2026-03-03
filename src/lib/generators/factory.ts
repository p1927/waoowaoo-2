/**
* Generator factory (enhanced)
 *
 * Supports:
 * - Create generator by provider
 */

import { ImageGenerator, VideoGenerator, AudioGenerator } from './base'
import { FalBananaGenerator } from './fal'
import { ArkSeedreamGenerator, ArkSeedanceVideoGenerator } from './ark'
import { FalVideoGenerator } from './fal'
import {
    GoogleGeminiImageGenerator,
    GoogleImagenGenerator,
    GoogleGeminiBatchImageGenerator,
    GeminiCompatibleImageGenerator,
    OpenAICompatibleImageGenerator,
} from './image'
import { GoogleVeoVideoGenerator } from './video/google'
import { OpenAICompatibleVideoGenerator, LumaVideoGenerator } from './video'
import { QwenTTSGenerator, GoogleCloudTTSGenerator } from './audio'
import { MinimaxVideoGenerator } from './minimax'
import { ViduVideoGenerator } from './vidu'
import { getProviderKey } from '@/lib/api-config'

/**
 * Create image generator by provider
 */
export function createImageGenerator(provider: string, modelId?: string): ImageGenerator {
    const normalizeModelId = (rawModelId?: string): string | undefined => {
        if (!rawModelId) return rawModelId
        const delimiterIndex = rawModelId.indexOf('::')
        return delimiterIndex === -1 ? rawModelId : rawModelId.slice(delimiterIndex + 2)
    }

    const actualModelId = normalizeModelId(modelId)
    const providerKey = getProviderKey(provider).toLowerCase()
    switch (providerKey) {
        case 'fal':
            return new FalBananaGenerator()
        case 'google':
            if (actualModelId === 'gemini-3-pro-image-preview-batch') {
                return new GoogleGeminiBatchImageGenerator()
            }
            if (actualModelId && actualModelId.startsWith('imagen-')) {
                return new GoogleImagenGenerator(actualModelId)
            }
            return new GoogleGeminiImageGenerator(actualModelId)
        case 'google-batch':  // Gemini Batch async mode
            return new GoogleGeminiBatchImageGenerator()
        case 'imagen':
            return new GoogleImagenGenerator(actualModelId)
        case 'ark':
            return new ArkSeedreamGenerator()
        case 'gemini-compatible':
            return new GeminiCompatibleImageGenerator(actualModelId, provider)
        case 'openai-compatible':
            return new OpenAICompatibleImageGenerator(actualModelId, provider)
        default:
            throw new Error(`Unknown image generator provider: ${provider}`)
    }
}

/**
 * Create video generator by provider
 */
export function createVideoGenerator(provider: string): VideoGenerator {
    const providerKey = getProviderKey(provider).toLowerCase()
    switch (providerKey) {
        case 'fal':
            return new FalVideoGenerator()
        case 'ark':
            return new ArkSeedanceVideoGenerator()
        case 'google':
            return new GoogleVeoVideoGenerator()
        case 'gemini-compatible':
            return new GoogleVeoVideoGenerator(provider)
        case 'minimax':
            return new MinimaxVideoGenerator()
        case 'vidu':
            return new ViduVideoGenerator()
        case 'luma':
            return new LumaVideoGenerator()
        case 'openai-compatible':
            return new OpenAICompatibleVideoGenerator(provider)
        default:
            throw new Error(`Unknown video generator provider: ${provider}`)
    }
}

/**
 * Create audio generator
 */
export function createAudioGenerator(provider: string): AudioGenerator {
    const providerKey = getProviderKey(provider).toLowerCase()
    switch (providerKey) {
        case 'qwen':
            return new QwenTTSGenerator()
        case 'google':
            return new GoogleCloudTTSGenerator()
        default:
            throw new Error(`Unknown audio generator provider: ${provider}`)
    }
}
