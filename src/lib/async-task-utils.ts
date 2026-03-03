/**
 * Async task utility functions
 * For querying third-party AI service task status
 *
 * Note: API Key is now passed via parameters, no longer uses env vars
 */

import { logInternal } from './logging/semantic'

export interface TaskStatus {
    status: 'pending' | 'completed' | 'failed'
    imageUrl?: string
    videoUrl?: string
    error?: string
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
    return value && typeof value === 'object' ? (value as UnknownRecord) : null
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    const record = asRecord(error)
    if (record && typeof record.message === 'string') return record.message
    return String(error)
}

function getErrorStatus(error: unknown): number | undefined {
    const record = asRecord(error)
    if (!record) return undefined
    return typeof record.status === 'number' ? record.status : undefined
}

interface GeminiBatchClient {
    batches: {
        get(args: { name: string }): Promise<unknown>
    }
}

/**
 * Query FAL Banana task status
 * @param requestId Task ID
 * @param apiKey FAL API Key
 */
export async function queryBananaTaskStatus(requestId: string, apiKey: string): Promise<TaskStatus> {
    if (!apiKey) {
        throw new Error('Please configure FAL API Key')
    }

    try {
        const statusResponse = await fetch(
            `https://queue.fal.run/fal-ai/nano-banana-pro/requests/${requestId}/status`,
            {
                headers: { 'Authorization': `Key ${apiKey}` },
                cache: 'no-store'
            }
        )

        if (!statusResponse.ok) {
            logInternal('Banana', 'ERROR', `Status query failed: ${statusResponse.status}`)
            return { status: 'pending' }
        }

        const data = await statusResponse.json()

        if (data.status === 'COMPLETED') {
            // Fetch result
            const resultResponse = await fetch(
                `https://queue.fal.run/fal-ai/nano-banana-pro/requests/${requestId}`,
                {
                    headers: { 'Authorization': `Key ${apiKey}` },
                    cache: 'no-store'
                }
            )

            if (resultResponse.ok) {
                const result = await resultResponse.json()
                const imageUrl = result.images?.[0]?.url

                if (imageUrl) {
                    return { status: 'completed', imageUrl }
                }
            }

            return { status: 'failed', error: 'No image URL in result' }
        } else if (data.status === 'FAILED') {
            return { status: 'failed', error: data.error || 'Banana generation failed' }
        }

        return { status: 'pending' }
    } catch (error: unknown) {
        logInternal('Banana', 'ERROR', 'Query error', { error: getErrorMessage(error) })
        return { status: 'pending' }
    }
}

/**
 * Query Gemini Batch task status
 * Uses ai.batches.get() to query task status
 * @param batchName Batch name (e.g. batches/xxx)
 * @param apiKey Google AI API Key
 */
export async function queryGeminiBatchStatus(batchName: string, apiKey: string): Promise<TaskStatus> {
    if (!apiKey) {
        throw new Error('Please configure Google AI API Key')
    }

    try {
        const { GoogleGenAI } = await import('@google/genai')
        const ai = new GoogleGenAI({ apiKey })

        // Use ai.batches.get to query task status
        const batchClient = ai as unknown as GeminiBatchClient
        const batchJob = await batchClient.batches.get({ name: batchName })
        const batchRecord = asRecord(batchJob) || {}

        const state = typeof batchRecord.state === 'string' ? batchRecord.state : 'UNKNOWN'
        logInternal('GeminiBatch', 'INFO', `Query status: ${batchName} -> ${state}`)

        // Check completion status
        if (state === 'JOB_STATE_SUCCEEDED') {
            // Extract image from inlinedResponses
            const dest = asRecord(batchRecord.dest)
            const responses = Array.isArray(dest?.inlinedResponses) ? dest.inlinedResponses : []

            if (responses.length > 0) {
                const firstResponse = asRecord(responses[0])
                const response = asRecord(firstResponse?.response)
                const candidates = Array.isArray(response?.candidates) ? response.candidates : []
                const firstCandidate = asRecord(candidates[0])
                const content = asRecord(firstCandidate?.content)
                const parts = Array.isArray(content?.parts) ? content.parts : []

                for (const part of parts) {
                    const partRecord = asRecord(part)
                    const inlineData = asRecord(partRecord?.inlineData)
                    if (typeof inlineData?.data === 'string') {
                        const imageBase64 = inlineData.data
                        const mimeType = typeof inlineData.mimeType === 'string' ? inlineData.mimeType : 'image/png'
                        const imageUrl = `data:${mimeType};base64,${imageBase64}`

                        logInternal('GeminiBatch', 'INFO', `Image fetched, MIME type: ${mimeType}`, { batchName })
                        return { status: 'completed', imageUrl }
                    }
                }
            }

            return { status: 'failed', error: 'No image data in batch result' }
        } else if (state === 'JOB_STATE_FAILED' || state === 'JOB_STATE_CANCELLED' || state === 'JOB_STATE_EXPIRED') {
            return { status: 'failed', error: `Gemini Batch failed: ${state}` }
        }

        // Still processing (PENDING, RUNNING, etc.)
        return { status: 'pending' }
    } catch (error: unknown) {
        const message = getErrorMessage(error)
        const status = getErrorStatus(error)
        logInternal('GeminiBatch', 'ERROR', 'Query error', { batchName, error: message, status })
        // If 404 or task not found, mark as failed (no retry)
        if (status === 404 || message.includes('404') || message.includes('not found') || message.includes('NOT_FOUND')) {
            return { status: 'failed', error: `Batch task not found` }
        }
        return { status: 'pending' }
    }
}

/**
 * Query Google Veo video task status
 * @param operationName Operation name (e.g. operations/xxx)
 * @param apiKey Google AI API Key
 */
export async function queryGoogleVideoStatus(operationName: string, apiKey: string): Promise<TaskStatus> {
    if (!apiKey) {
        throw new Error('Please configure Google AI API Key')
    }

    const logPrefix = '[Veo Query]'

    try {
        const { GoogleGenAI, GenerateVideosOperation } = await import('@google/genai')
        const ai = new GoogleGenAI({ apiKey })
        const operation = new GenerateVideosOperation()
        operation.name = operationName
        const op = await ai.operations.getVideosOperation({ operation })

        // Log full response for debugging
        logInternal('Veo', 'INFO', `${logPrefix} Raw response`, {
            operationName,
            done: op.done,
            hasError: !!op.error,
            hasResponse: !!op.response,
            responseKeys: op.response ? Object.keys(op.response) : [],
            generatedVideosCount: op.response?.generatedVideos?.length ?? 0,
            raiFilteredCount: (op.response as Record<string, unknown>)?.raiMediaFilteredCount ?? null,
            raiFilteredReasons: (op.response as Record<string, unknown>)?.raiMediaFilteredReasons ?? null,
        })

        if (!op.done) {
            return { status: 'pending' }
        }

        // Check operation-level error
        if (op.error) {
            const errRecord = asRecord(op.error)
            const message = (typeof errRecord?.message === 'string' && errRecord.message)
                || (typeof errRecord?.statusMessage === 'string' && errRecord.statusMessage)
                || 'Veo task failed'
            logInternal('Veo', 'ERROR', `${logPrefix} Operation-level error`, { operationName, error: op.error })
            return { status: 'failed', error: message }
        }

        const response = op.response
        if (!response) {
            logInternal('Veo', 'ERROR', `${logPrefix} done=true but response is empty`, { operationName })
            return { status: 'failed', error: 'Veo task completed but response body is empty' }
        }

        // Check RAI content filtering
        const responseRecord = asRecord(response) || {}
        const raiFilteredCount = responseRecord.raiMediaFilteredCount
        const raiFilteredReasons = responseRecord.raiMediaFilteredReasons

        if (typeof raiFilteredCount === 'number' && raiFilteredCount > 0) {
            const reasons = Array.isArray(raiFilteredReasons)
                ? raiFilteredReasons.join(', ')
                : 'Unknown reason'
            logInternal('Veo', 'ERROR', `${logPrefix} Video filtered by RAI safety policy`, {
                operationName,
                raiFilteredCount,
                raiFilteredReasons: reasons,
            })
            return {
                status: 'failed',
                error: `Veo video filtered by safety policy (${raiFilteredCount} videos filtered, reason: ${reasons})`,
            }
        }

        // Extract video URL
        const generatedVideos = response.generatedVideos
        if (Array.isArray(generatedVideos) && generatedVideos.length > 0) {
            const first = generatedVideos[0]
            const videoUri = first?.video?.uri

            if (videoUri) {
                logInternal('Veo', 'INFO', `${logPrefix} Got video`, {
                    operationName,
                    videoUri: videoUri.substring(0, 80),
                })
                return { status: 'completed', videoUrl: videoUri }
            }

            logInternal('Veo', 'ERROR', `${logPrefix} generatedVideos[0] exists but no video.uri`, {
                operationName,
                firstVideo: JSON.stringify(first, null, 2),
            })
            return { status: 'failed', error: 'Veo video object exists but missing URI' }
        }

        logInternal('Veo', 'ERROR', `${logPrefix} No generatedVideos`, {
            operationName,
            responseKeys: Object.keys(responseRecord),
            fullResponse: JSON.stringify(responseRecord, null, 2).substring(0, 2000),
            raiFilteredCount: raiFilteredCount ?? 'N/A',
            raiFilteredReasons: raiFilteredReasons ?? 'N/A',
        })
        return { status: 'failed', error: 'Veo task completed but no video (generatedVideos empty)' }
    } catch (error: unknown) {
        const message = getErrorMessage(error)
        logInternal('Veo', 'ERROR', `${logPrefix} Query error`, { operationName, error: message })
        return { status: 'failed', error: message }
    }
}

const DEFAULT_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

/**
 * Query Seedance video task status.
 * @param taskId Task ID
 * @param apiKey Ark API Key
 * @param baseUrl Optional Ark base URL (defaults to Volcengine China)
 */
export async function querySeedanceVideoStatus(taskId: string, apiKey: string, baseUrl?: string): Promise<TaskStatus> {
    if (!apiKey) {
        throw new Error('Please configure Ark API Key')
    }

    const arkBaseUrl = baseUrl?.trim() || DEFAULT_ARK_BASE_URL
    try {
        const queryResponse = await fetch(
            `${arkBaseUrl}/contents/generations/tasks/${taskId}`,
            {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`
                },
                cache: 'no-store'
            }
        )

        if (!queryResponse.ok) {
            logInternal('Seedance', 'ERROR', `Status query failed: ${queryResponse.status}`)
            return { status: 'pending' }
        }

        const queryData = await queryResponse.json()
        const status = queryData.status

        if (status === 'succeeded') {
            const videoUrl = queryData.content?.video_url

            if (videoUrl) {
                return { status: 'completed', videoUrl }
            }

            return { status: 'failed', error: 'No video URL in response' }
        } else if (status === 'failed') {
            const errorObj = queryData.error || {}
            const errorMessage = errorObj.message || 'Unknown error'
            return { status: 'failed', error: errorMessage }
        }

        return { status: 'pending' }
    } catch (error: unknown) {
        logInternal('Seedance', 'ERROR', 'Query error', { error: getErrorMessage(error) })
        return { status: 'pending' }
    }
}
