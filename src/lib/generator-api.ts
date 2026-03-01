import { logInfo as _ulogInfo } from '@/lib/logging/core'
/**
 * Generator unified entry (enhanced)
 *
 * Supports:
 * - Strict use of model_key (provider::modelId)
 * - Dynamic routing for user custom models (via config center only)
 * - Unified error handling
 */

import { createAudioGenerator, createImageGenerator, createVideoGenerator } from './generators/factory'
import type { GenerateResult } from './generators/base'
import { resolveModelSelection } from './api-config'

/**
 * Generate image (simplified)
 *
 * @param userId User ID
 * @param modelKey Model unique key (provider::modelId)
 * @param prompt Prompt
 * @param options Generation options
 */
export async function generateImage(
    userId: string,
    modelKey: string,
    prompt: string,
    options?: {
        referenceImages?: string[]
        aspectRatio?: string
        resolution?: string
        outputFormat?: string
        keepOriginalAspectRatio?: boolean  // Keep original aspect ratio when editing
        size?: string  // Direct pixel size e.g. "5016x3344" (takes precedence over aspectRatio)
    }
): Promise<GenerateResult> {
    const selection = await resolveModelSelection(userId, modelKey, 'image')
    const generator = createImageGenerator(selection.provider, selection.modelId)
    _ulogInfo(`[generateImage] resolved model selection: ${selection.modelKey}`)

    // Call generate (pass referenceImages separately, merge other options into options)
    const { referenceImages, ...generatorOptions } = options || {}
    return generator.generate({
        userId,
        prompt,
        referenceImages,
        options: {
            ...generatorOptions,
            provider: selection.provider,
            modelId: selection.modelId,
            modelKey: selection.modelKey,
        }
    })
}

/**
 * Generate video (enhanced)
 *
 * @param userId User ID
 * @param modelKey Model unique key (provider::modelId)
 * @param imageUrl Input image URL
 * @param options Generation options
 */
export async function generateVideo(
    userId: string,
    modelKey: string,
    imageUrl: string,
    options?: {
        prompt?: string
        duration?: number
        fps?: number
        resolution?: string      // '720p' | '1080p'
        aspectRatio?: string     // '16:9' | '9:16'
        generateAudio?: boolean  // Seedance 1.5 Pro only
        lastFrameImageUrl?: string  // Last frame image for first-last frame mode
        [key: string]: string | number | boolean | undefined
    }
): Promise<GenerateResult> {
    const selection = await resolveModelSelection(userId, modelKey, 'video')
    const generator = createVideoGenerator(selection.provider)
    _ulogInfo(`[generateVideo] resolved model selection: ${selection.modelKey}`)

    const { prompt, ...providerOptions } = options || {}

    return generator.generate({
        userId,
        imageUrl,
        prompt,
        options: {
            ...providerOptions,
            provider: selection.provider,
            modelId: selection.modelId,
            modelKey: selection.modelKey,
        }
    })
}

/**
 * Generate audio/speech
 */
export async function generateAudio(
    userId: string,
    modelKey: string,
    text: string,
    options?: {
        voice?: string
        rate?: number
    }
): Promise<GenerateResult> {
    const selection = await resolveModelSelection(userId, modelKey, 'audio')
    const generator = createAudioGenerator(selection.provider)

    return generator.generate({
        userId,
        text,
        voice: options?.voice,
        rate: options?.rate,
        options: {
            provider: selection.provider,
            modelId: selection.modelId,
            modelKey: selection.modelKey,
        },
    })
}
