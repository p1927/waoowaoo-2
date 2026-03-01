import { logInfo as _ulogInfo, logWarn as _ulogWarn, logErrorCtx } from '@/lib/logging/core'
import { getLogContext } from '@/lib/logging/context'
/**
 * Gemini-compatible image generator
 *
 * Supports third-party services using Google Gemini API format (e.g. GRSAI/Nano Banana)
 * Connect via custom baseUrl and API Key
 */

import { GoogleGenAI, HarmCategory, HarmBlockThreshold } from '@google/genai'
import { BaseImageGenerator, ImageGenerateParams, GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { getImageBase64Cached } from '@/lib/image-cache'

type ContentPart = { inlineData: { mimeType: string; data: string } } | { text: string }

function getPartKeys(part: unknown): string {
    if (!part || typeof part !== 'object') return 'unknown'
    return Object.keys(part).join(',')
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
        const candidate = (error as { message?: unknown }).message
        if (typeof candidate === 'string') return candidate
    }
    return 'Unknown error'
}

export class GeminiCompatibleImageGenerator extends BaseImageGenerator {
    private modelId: string
    private providerId?: string

    constructor(modelId?: string, providerId?: string) {
        super()
        // Default to nano-banana-fast model
        this.modelId = modelId || 'nano-banana-fast'
        this.providerId = providerId
    }

    protected async doGenerate(params: ImageGenerateParams): Promise<GenerateResult> {
        const { userId, prompt, referenceImages = [], options = {} } = params

        const config = await getProviderConfig(userId, this.providerId || 'gemini-compatible')
        if (!config.baseUrl) {
            throw new Error(`PROVIDER_BASE_URL_MISSING: ${config.id}`)
        }
        const {
            aspectRatio,
            resolution,
        } = options

        const allowedOptionKeys = new Set([
            'provider',
            'modelId',
            'modelKey',
            'aspectRatio',
            'resolution',
            'outputFormat',
        ])
        for (const [key, value] of Object.entries(options)) {
            if (value === undefined) continue
            if (!allowedOptionKeys.has(key)) {
                throw new Error(`GEMINI_COMPATIBLE_IMAGE_OPTION_UNSUPPORTED: ${key}`)
            }
        }

        // Initialize SDK with custom baseUrl
        // @google/genai SDK supports custom endpoint via httpOptions.baseUrl
        const ai = new GoogleGenAI({
            apiKey: config.apiKey,
            httpOptions: {
                baseUrl: config.baseUrl
            }
        })

        // Build content parts array
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
                    // Local mode: relative path needs full URL
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

        const ctx = getLogContext()

        logErrorCtx(ctx, `[GeminiCompatible] Using model: ${this.modelId}, baseUrl: ${config.baseUrl}`)

        // Request params debug log
        const imagePartsSummary = contentParts
            .filter((p): p is { inlineData: { mimeType: string; data: string } } => 'inlineData' in p)
            .map((p, i) => `img${i + 1}: ${p.inlineData.mimeType}, ${Math.round(p.inlineData.data.length / 1024)}KB`)
        const textPartsSummary = contentParts
            .filter((p): p is { text: string } => 'text' in p)
            .map(p => p.text.substring(0, 200))
        logErrorCtx(ctx, `[GeminiCompatible] Request params:`, JSON.stringify({
            model: this.modelId,
            aspectRatio,
            resolution,
            refImageCount: referenceImages.length,
            contentPartsCount: contentParts.length,
            imagePartsSummary,
            promptPreview: textPartsSummary[0] || '(empty)',
        }))

        try {
            // Call API (using user-configured model name)
            const response = await ai.models.generateContent({
                model: this.modelId,
                contents: [{ parts: contentParts }],
                config: {
                    safetySettings,
                    // 🔥 关键：告诉 Gemini 返回图片
                    responseModalities: ['IMAGE', 'TEXT'],
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
                        _ulogInfo(`[GeminiCompatible] Image generated successfully`)
                        return {
                            success: true,
                            imageBase64,
                            imageUrl: `data:${mimeType};base64,${imageBase64}`
                        }
                    }
                }
            }

            // 检查失败原因
            const finishReason = candidate?.finishReason
            if (finishReason === 'IMAGE_SAFETY' || finishReason === 'SAFETY') {
                throw new Error('Content filtered by safety policy')
            }

            // Check if proxy returned text instead of image (common proxy routing issue)
            const textParts = parts.filter((part) => typeof part?.text === 'string')
            if (textParts.length > 0) {
                _ulogWarn(`[GeminiCompatible] Proxy returned text instead of image: ${textParts[0].text?.substring(0, 100)}...`)
                throw new Error('Proxy service returned text instead of image, check model configuration')
            }

            // Detailed log: full response structure
            logErrorCtx(ctx, `[GeminiCompatible] Response did not contain image, debug info:`)
            logErrorCtx(ctx, `  - candidates count: ${response.candidates?.length || 0}`)
            logErrorCtx(ctx, `  - parts count: ${parts.length}`)
            logErrorCtx(ctx, `  - finishReason: ${candidate?.finishReason}`)
            logErrorCtx(ctx, `  - parts types: ${parts.map((part) => getPartKeys(part)).join(' | ')}`)
            logErrorCtx(ctx, `  - full response: ${JSON.stringify(response, null, 2)}`)

            throw new Error('Gemini compatible service did not return image')
        } catch (error: unknown) {
            const message = getErrorMessage(error)

            // 🔥 增强诊断：解析代理/SDK 返回的结构化错误信息
            const errorObj = error as Record<string, unknown> | undefined
            const innerError = (errorObj?.error ?? errorObj) as Record<string, unknown> | undefined
            const errorType = innerError?.type as string | undefined
            const errorCode = innerError?.code as string | undefined
            const errorParam = innerError?.param as string | undefined
            const statusCode = (errorObj as { status?: number })?.status
            const responseBody = (errorObj as { responseBody?: unknown })?.responseBody

            logErrorCtx(ctx, `[GeminiCompatible] Generation failed:`, JSON.stringify({
                message,
                errorType: errorType || null,
                errorCode: errorCode || null,
                errorParam: errorParam || null,
                statusCode: statusCode || null,
                model: this.modelId,
                baseUrl: config.baseUrl,
                refImageCount: referenceImages.length,
                promptPreview: prompt.substring(0, 100),
                ...(responseBody ? { responseBody: JSON.stringify(responseBody).substring(0, 500) } : {}),
                stack: error instanceof Error ? error.stack?.split('\n').slice(0, 3).join(' | ') : undefined,
            }))

            // Handle common errors (order: content safety > balance > network > 429 rate limit > other)
            const lowerMessage = message.toLowerCase()

            // 1. Content safety (before 429, proxy may wrap IMAGE_SAFETY as 429)
            if (lowerMessage.includes('image_safety') || lowerMessage.includes('safety') ||
                lowerMessage.includes('sensitive') || lowerMessage.includes('blocked') ||
                lowerMessage.includes('policy_violation') || lowerMessage.includes('prohibited') ||
                lowerMessage.includes('moderation') || lowerMessage.includes('harm')) {
                throw new Error('Image content may involve sensitive information, please modify description and retry')
            }

            // 2. Balance/quota insufficient
            if (lowerMessage.includes('insufficient') || lowerMessage.includes('402') ||
                lowerMessage.includes('credits')) {
                throw new Error('API balance insufficient, please recharge and retry')
            }

            // 3. Auth error
            if (lowerMessage.includes('401') || lowerMessage.includes('unauthorized')) {
                throw new Error('API Key invalid, please check configuration')
            }

            // 4. Model not found
            if (lowerMessage.includes('404') || lowerMessage.includes('not found')) {
                throw new Error(`Model ${this.modelId} does not exist on server`)
            }

            // 5. Network error
            if (lowerMessage.includes('fetch failed') || lowerMessage.includes('econnreset') ||
                lowerMessage.includes('enotfound') || lowerMessage.includes('network')) {
                throw new Error('Network request failed, check connection or retry later')
            }

            // 6. Gemini empty response (proxy may wrap as 429, but actual cause is content generation failed/filtered)
            if (lowerMessage.includes('empty_response') || lowerMessage.includes('empty response') ||
                lowerMessage.includes('no meaningful content')) {
                throw new Error('Gemini did not return valid image, content may be filtered or generation failed, modify description and retry')
            }

            // 7. 429 rate limit (excluding empty_response and safety already caught above)
            if (statusCode === 429 || lowerMessage.includes('rate') || lowerMessage.includes('too many request')) {
                throw new Error('API rate limit exceeded, please retry later')
            }

            // 8. Quota limit (generic)
            if (lowerMessage.includes('quota') || lowerMessage.includes('limit')) {
                throw new Error('API quota insufficient')
            }

            throw error
        }
    }
}
