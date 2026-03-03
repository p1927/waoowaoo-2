/**
 * Luma Dream Machine video generator
 *
 * Models: ray-2, ray-flash-2
 * API: https://api.lumalabs.ai/dream-machine/v1
 * Auth: Bearer token
 */

import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { BaseVideoGenerator, VideoGenerateParams, GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'

const LUMA_BASE_URL = 'https://api.lumalabs.ai/dream-machine/v1'

const LUMA_VALID_MODELS = new Set(['ray-2', 'ray-flash-2'])
const LUMA_VALID_DURATIONS = new Set(['5s', '9s'])
const LUMA_VALID_RESOLUTIONS = new Set(['540p', '720p', '1080p', '4k'])
const LUMA_VALID_ASPECT_RATIOS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21'])

interface LumaVideoOptions {
    modelId?: string
    duration?: number
    resolution?: string
    aspectRatio?: string
    lastFrameImageUrl?: string
}

interface LumaKeyframeImage {
    type: 'image'
    url: string
}

interface LumaKeyframes {
    frame0?: LumaKeyframeImage
    frame1?: LumaKeyframeImage
}

interface LumaGenerationRequest {
    model: string
    prompt?: string
    keyframes?: LumaKeyframes
    resolution?: string
    duration?: string
    aspect_ratio?: string
}

interface LumaGenerationResponse {
    id: string
    state: 'queued' | 'dreaming' | 'completed' | 'failed'
    failure_reason?: string
    assets?: {
        video?: string
    }
}

function normalizeDuration(raw: number | undefined): string | undefined {
    if (raw === undefined) return undefined
    const durationStr = `${raw}s`
    if (!LUMA_VALID_DURATIONS.has(durationStr)) {
        throw new Error(`LUMA_VIDEO_OPTION_VALUE_UNSUPPORTED: duration=${raw}`)
    }
    return durationStr
}

export class LumaVideoGenerator extends BaseVideoGenerator {
    protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
        const { userId, imageUrl, prompt = '', options = {} } = params

        const { apiKey } = await getProviderConfig(userId, 'luma')
        const rawOptions = options as LumaVideoOptions

        const modelId = rawOptions.modelId || 'ray-2'
        if (!LUMA_VALID_MODELS.has(modelId)) {
            throw new Error(`LUMA_VIDEO_MODEL_UNSUPPORTED: ${modelId}`)
        }

        const allowedOptionKeys = new Set([
            'provider',
            'modelId',
            'modelKey',
            'duration',
            'resolution',
            'aspectRatio',
            'lastFrameImageUrl',
        ])
        for (const [key, value] of Object.entries(options)) {
            if (value === undefined) continue
            if (!allowedOptionKeys.has(key)) {
                throw new Error(`LUMA_VIDEO_OPTION_UNSUPPORTED: ${key}`)
            }
        }

        if (rawOptions.resolution !== undefined && !LUMA_VALID_RESOLUTIONS.has(rawOptions.resolution)) {
            throw new Error(`LUMA_VIDEO_OPTION_VALUE_UNSUPPORTED: resolution=${rawOptions.resolution}`)
        }

        if (rawOptions.aspectRatio !== undefined && !LUMA_VALID_ASPECT_RATIOS.has(rawOptions.aspectRatio)) {
            throw new Error(`LUMA_VIDEO_OPTION_VALUE_UNSUPPORTED: aspectRatio=${rawOptions.aspectRatio}`)
        }

        const duration = normalizeDuration(rawOptions.duration)

        const logPrefix = `[Luma Video ${modelId}]`

        const keyframes: LumaKeyframes = {
            frame0: { type: 'image', url: imageUrl },
        }

        if (rawOptions.lastFrameImageUrl) {
            keyframes.frame1 = { type: 'image', url: rawOptions.lastFrameImageUrl }
            _ulogInfo(`${logPrefix} Using first+last frame keyframes`)
        }

        const requestBody: LumaGenerationRequest = {
            model: modelId,
            keyframes,
        }

        if (prompt) {
            requestBody.prompt = prompt
        }
        if (duration) {
            requestBody.duration = duration
        }
        if (rawOptions.resolution) {
            requestBody.resolution = rawOptions.resolution
        }
        if (rawOptions.aspectRatio) {
            requestBody.aspect_ratio = rawOptions.aspectRatio
        }

        _ulogInfo(
            `${logPrefix} Submitting task, duration=${duration ?? '(default)'}, resolution=${rawOptions.resolution ?? '(default)'}`,
        )

        try {
            const response = await fetch(`${LUMA_BASE_URL}/generations`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody),
            })

            if (!response.ok) {
                const errorText = await response.text()
                _ulogError(`${logPrefix} API request failed:`, response.status, errorText)
                throw new Error(`Luma API Error: ${response.status} - ${errorText}`)
            }

            const data = (await response.json()) as LumaGenerationResponse

            if (!data.id) {
                _ulogError(`${logPrefix} Response missing id:`, data)
                throw new Error('Luma did not return generation id')
            }

            if (data.state === 'failed') {
                const reason = data.failure_reason || 'Generation failed'
                _ulogError(`${logPrefix} Task failed immediately:`, reason)
                throw new Error(`Luma: ${reason}`)
            }

            _ulogInfo(`${logPrefix} Task submitted, id=${data.id}, state=${data.state}`)

            return {
                success: true,
                async: true,
                requestId: data.id,
                externalId: `LUMA:VIDEO:${data.id}`,
            }
        } catch (error: unknown) {
            _ulogError(`${logPrefix} Generation failed:`, error)
            throw error
        }
    }
}
