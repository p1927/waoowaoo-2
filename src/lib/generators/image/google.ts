import { logInfo as _ulogInfo, logWarn as _ulogWarn } from '@/lib/logging/core'
/**
 * Google AI image generator
 *
 * Supports:
 * - Gemini 3 Pro Image (real-time)
 * - Gemini 2.5 Flash Image (real-time)
 * - Imagen 4
 */

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai'
import { BaseImageGenerator, ImageGenerateParams, GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { getImageBase64Cached } from '@/lib/image-cache'

type ContentPart = { inlineData: { mimeType: string; data: string } } | { text: string }

interface ImagenResponse {
    generatedImages?: Array<{
        image?: {
            imageBytes?: string
        }
    }>
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
        const candidate = (error as { message?: unknown }).message
        if (typeof candidate === 'string') return candidate
    }
    return 'Unknown error'
}

export class GoogleGeminiImageGenerator extends BaseImageGenerator {
    private modelId: string

    constructor(modelId: string = 'gemini-3-pro-image-preview') {
        super()
        this.modelId = modelId
    }

    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'google')
        const {
            aspectRatio,
            resolution
        } = options as {
            aspectRatio?: string
            resolution?: string
            provider?: string
            modelId?: string
            modelKey?: string
        }

        const allowedOptionKeys = new Set([
            'provider',
            'modelId',
            'modelKey',
            'aspectRatio',
            'resolution',
        ])
        for (const [key, value] of Object.entries(options)) {
            if (value === undefined) continue
            if (!allowedOptionKeys.has(key)) {
                throw new Error(`GOOGLE_IMAGE_OPTION_UNSUPPORTED: ${key}`)
            }
        }

        const ai = new GoogleGenAI({ apiKey })

        // Build content array
        const contentParts: ContentPart[] = []

        // Add reference images (max 14)
        for (let i = 0; i < Math.min(referenceImages.length, 14); i++) {
            const imageData = referenceImages[i]

            if (imageData.startsWith('data:')) {
                // Base64 format
                const base64Start = imageData.indexOf(';base64,')
                if (base64Start !== -1) {
                    const mimeType = imageData.substring(5, base64Start)
                    const data = imageData.substring(base64Start + 8)
                    contentParts.push({ inlineData: { mimeType, data } })
                }
            } else if (imageData.startsWith('http') || imageData.startsWith('/')) {
                // URL format (including local path /api/files/...): download and convert to base64
                try {
                    // Local mode fix: relative path needs full URL
                    let fullUrl = imageData
                    if (imageData.startsWith('/')) {
                        const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
                        fullUrl = `${baseUrl}${imageData}`
                    }
                    const base64DataUrl = await getImageBase64Cached(fullUrl)
                    const base64Start = base64DataUrl.indexOf(';base64,')
                    if (base64Start !== -1) {
                        const mimeType = base64DataUrl.substring(5, base64Start)
                        const data = base64DataUrl.substring(base64Start + 8)
                        contentParts.push({ inlineData: { mimeType, data } })
                    }
                } catch (e) {
                    _ulogWarn(`Failed to download reference image ${i + 1}:`, e)
                }
            } else {
                // Raw base64
                contentParts.push({
                    inlineData: { mimeType: 'image/png', data: imageData }
                })
            }
        }

        // Add text prompt
        contentParts.push({ text: prompt })

        // Safety config (filtering disabled)
        const safetySettings = [
            { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
            { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
        ]

        // Call API
        const response = await ai.models.generateContent({
            model: this.modelId,
            contents: [{ parts: contentParts }],
            config: {
                responseModalities: ['TEXT', 'IMAGE'],
                safetySettings,
                ...(aspectRatio || resolution
                    ? {
                        imageConfig: {
                            ...(aspectRatio ? { aspectRatio } : {}),
                            ...(resolution ? { imageSize: resolution } : {}),
                        },
                    }
                    : {})
            }
        })

        // Extract image
        const candidate = response.candidates?.[0]
        const parts = candidate?.content?.parts || []

        for (const part of parts) {
            if (part.inlineData) {
                const imageBase64 = part.inlineData.data
                if (imageBase64) {
                    const mimeType = part.inlineData.mimeType || 'image/png'
                    return {
                        success: true,
                        imageBase64,
                        imageUrl: `data:${mimeType};base64,${imageBase64}`
                    }
                }
            }
        }

        // Check failure reason
        const finishReason = candidate?.finishReason
        if (finishReason === 'IMAGE_SAFETY' || finishReason === 'SAFETY') {
            throw new Error('Content filtered by safety policy')
        }

        throw new Error('Gemini did not return image')
    }
}

/**
 * Google Imagen 4 image generator
 *
 * Uses Imagen 4 API (different from Gemini API)
 * Supports: imagen-4.0-generate-001, imagen-4.0-fast-generate-001, imagen-4.0-ultra-generate-001
 */
export class GoogleImagenGenerator extends BaseImageGenerator {
    private modelId: string

    constructor(modelId: string = 'imagen-4.0-generate-001') {
        super()
        this.modelId = modelId
    }

    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'google')
        const {
            aspectRatio,
        } = options

        const ai = new GoogleGenAI({ apiKey })

        try {
            // Use Imagen API (different from Gemini generateContent)
            const response = await ai.models.generateImages({
                model: this.modelId,
                prompt,
                config: {
                    numberOfImages: 1,
                    ...(aspectRatio ? { aspectRatio } : {}),
                }
            })

            // Extract image
            const generatedImages = (response as ImagenResponse).generatedImages
            if (generatedImages && generatedImages.length > 0) {
                const imageBytes = generatedImages[0].image?.imageBytes
                if (imageBytes) {
                    return {
                        success: true,
                        imageBase64: imageBytes,
                        imageUrl: `data:image/png;base64,${imageBytes}`
                    }
                }
            }

            throw new Error('Imagen did not return image')
        } catch (error: unknown) {
            const message = getErrorMessage(error)
            // Check safety filter
            if (message.includes('SAFETY') || message.includes('blocked')) {
                throw new Error('Content filtered by safety policy')
            }
            throw error
        }
    }
}

/**
 * Google Gemini Batch image generator (async mode)
 *
 * Uses ai.batches.create() to submit batch tasks
 * 50% of standard API price, processing within 24 hours
 */
export class GoogleGeminiBatchImageGenerator extends BaseImageGenerator {
    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'google')
        const {
            aspectRatio,
            resolution
        } = options as {
            aspectRatio?: string
            resolution?: string
            provider?: string
            modelId?: string
            modelKey?: string
        }

        // 使用 Batch API 提交异步任务
        const { submitGeminiBatch } = await import('@/lib/gemini-batch-utils')

        const result = await submitGeminiBatch(apiKey, prompt, {
            referenceImages,
            ...(aspectRatio ? { aspectRatio } : {}),
            ...(resolution ? { resolution } : {}),
        })

        if (!result.success || !result.batchName) {
            return {
                success: false,
                error: result.error || 'Gemini Batch 提交失败'
            }
        }

        // 返回异步标识
        _ulogInfo(`[Gemini Batch Generator] ✅ 异步任务已提交: ${result.batchName}`)
        return {
            success: true,
            async: true,
            requestId: result.batchName,  // 向后兼容，格式: batches/xxx
            externalId: `GEMINI:BATCH:${result.batchName}`  // 🔥 标准格式
        }
    }
}
