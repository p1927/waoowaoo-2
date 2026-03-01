import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

/**
 * Unified async task polling module
 *
 * Standard format: PROVIDER:TYPE:REQUEST_ID
 *
 * Examples:
 * - FAL:VIDEO:fal-ai/wan/v2.6:abc123
 * - FAL:IMAGE:fal-ai/nano-banana-pro:def456
 * - ARK:VIDEO:task_789
 * - ARK:IMAGE:task_xyz
 * - GEMINI:BATCH:batches/ghi012
 *
 * Note: Only accepts standard externalId (no legacy format support)
 */

import { queryFalStatus } from './async-submit'
import { queryGeminiBatchStatus, querySeedanceVideoStatus, queryGoogleVideoStatus } from './async-task-utils'
import { getProviderConfig } from './api-config'

export interface PollResult {
    status: 'pending' | 'completed' | 'failed'
    resultUrl?: string
    imageUrl?: string
    videoUrl?: string
    downloadHeaders?: Record<string, string>
    error?: string
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
        const candidate = (error as { message?: unknown }).message
        if (typeof candidate === 'string') return candidate
    }
    return 'Query error'
}

/**
 * Parse externalId to get provider, type and request info
 */
export function parseExternalId(externalId: string): {
    provider: 'FAL' | 'ARK' | 'GEMINI' | 'GOOGLE' | 'MINIMAX' | 'VIDU' | 'OPENAI' | 'UNKNOWN'
    type: 'VIDEO' | 'IMAGE' | 'BATCH' | 'UNKNOWN'
    endpoint?: string
    requestId: string
    providerToken?: string
} {
    // 标准格式：PROVIDER:TYPE:...
    if (externalId.startsWith('FAL:')) {
        const parts = externalId.split(':')

        if (parts[1] === 'VIDEO' || parts[1] === 'IMAGE') {
            if (parts.length < 4) {
                throw new Error(`Invalid FAL externalId: "${externalId}", expected FAL:TYPE:endpoint:requestId`)
            }
            const endpoint = parts.slice(2, -1).join(':')
            const requestId = parts[parts.length - 1]
            if (!endpoint || !requestId) {
                throw new Error(`Invalid FAL externalId: "${externalId}", missing endpoint or requestId`)
            }
            return {
                provider: 'FAL',
                type: parts[1] as 'VIDEO' | 'IMAGE',
                endpoint,
                requestId,
            }
        }
        throw new Error(`Invalid FAL externalId: "${externalId}", TYPE must be VIDEO or IMAGE`)
    }

    if (externalId.startsWith('ARK:')) {
        const parts = externalId.split(':')
        const type = parts[1]
        const requestId = parts.slice(2).join(':')
        if ((type !== 'VIDEO' && type !== 'IMAGE') || !requestId) {
            throw new Error(`Invalid ARK externalId: "${externalId}", expected ARK:TYPE:requestId`)
        }
        return {
            provider: 'ARK',
            type: type as 'VIDEO' | 'IMAGE',
            requestId,
        }
    }

    if (externalId.startsWith('GEMINI:')) {
        const parts = externalId.split(':')
        const type = parts[1]
        const requestId = parts.slice(2).join(':')
        if (type !== 'BATCH' || !requestId) {
            throw new Error(`Invalid GEMINI externalId: "${externalId}", expected GEMINI:BATCH:batchName`)
        }
        return {
            provider: 'GEMINI',
            type: 'BATCH',
            requestId,
        }
    }

    if (externalId.startsWith('GOOGLE:')) {
        const parts = externalId.split(':')
        const type = parts[1]
        const requestId = parts.slice(2).join(':')
        if (type !== 'VIDEO' || !requestId) {
            throw new Error(`Invalid GOOGLE externalId: "${externalId}", expected GOOGLE:VIDEO:operationName`)
        }
        return {
            provider: 'GOOGLE',
            type: 'VIDEO',
            requestId,
        }
    }

    if (externalId.startsWith('MINIMAX:')) {
        const parts = externalId.split(':')
        const type = parts[1]
        const requestId = parts.slice(2).join(':')
        if ((type !== 'VIDEO' && type !== 'IMAGE') || !requestId) {
            throw new Error(`Invalid MINIMAX externalId: "${externalId}", expected MINIMAX:TYPE:taskId`)
        }
        return {
            provider: 'MINIMAX',
            type: type as 'VIDEO' | 'IMAGE',
            requestId,
        }
    }

    if (externalId.startsWith('VIDU:')) {
        const parts = externalId.split(':')
        const type = parts[1]
        const requestId = parts.slice(2).join(':')
        if ((type !== 'VIDEO' && type !== 'IMAGE') || !requestId) {
            throw new Error(`Invalid VIDU externalId: "${externalId}", expected VIDU:TYPE:taskId`)
        }
        return {
            provider: 'VIDU',
            type: type as 'VIDEO' | 'IMAGE',
            requestId,
        }
    }

    if (externalId.startsWith('OPENAI:')) {
        const parts = externalId.split(':')
        const type = parts[1]
        const providerToken = parts[2]
        const requestId = parts.slice(3).join(':')
        if (type !== 'VIDEO' || !providerToken || !requestId) {
            throw new Error(`Invalid OPENAI externalId: "${externalId}", expected OPENAI:VIDEO:providerToken:videoId`)
        }
        return {
            provider: 'OPENAI',
            type: 'VIDEO',
            providerToken,
            requestId,
        }
    }

    throw new Error(
        `Unrecognized externalId format: "${externalId}". ` +
        `Supported: FAL:TYPE:endpoint:requestId, ARK:TYPE:requestId, GEMINI:BATCH:batchName, GOOGLE:VIDEO:operationName, MINIMAX:TYPE:taskId, VIDU:TYPE:taskId, OPENAI:VIDEO:providerToken:videoId`
    )
}

/**
 * Unified polling entry
 * Selects query function by externalId format
 */
export async function pollAsyncTask(
    externalId: string,
    userId: string
): Promise<PollResult> {
    if (!userId) {
        throw new Error('Missing user ID, cannot get API Key')
    }

    const parsed = parseExternalId(externalId)
    _ulogInfo(`[Poll] Parsed ${externalId.slice(0, 30)}... → provider=${parsed.provider}, type=${parsed.type}`)

    switch (parsed.provider) {
        case 'FAL':
            return await pollFalTask(parsed.endpoint!, parsed.requestId, userId)
        case 'ARK':
            return await pollArkTask(parsed.requestId, userId)
        case 'GEMINI':
            return await pollGeminiTask(parsed.requestId, userId)
        case 'GOOGLE':
            return await pollGoogleVideoTask(parsed.requestId, userId)
        case 'MINIMAX':
            return await pollMinimaxTask(parsed.requestId, userId)
        case 'VIDU':
            return await pollViduTask(parsed.requestId, userId)
        case 'OPENAI':
            return await pollOpenAIVideoTask(parsed.requestId, userId, parsed.providerToken)
        default:
            // Unknown provider, throw directly
            throw new Error(`Unknown provider: ${parsed.provider}`)
    }
}

function decodeProviderId(token: string): string {
    try {
        return Buffer.from(token, 'base64url').toString('utf8')
    } catch {
        throw new Error('OPENAI_PROVIDER_TOKEN_INVALID')
    }
}

async function pollOpenAIVideoTask(
    videoId: string,
    userId: string,
    providerToken?: string,
): Promise<PollResult> {
    if (!providerToken) {
        throw new Error('OPENAI_PROVIDER_TOKEN_MISSING')
    }
    const providerId = decodeProviderId(providerToken)
    const config = await getProviderConfig(userId, providerId)
    if (!config.baseUrl) {
        throw new Error(`PROVIDER_BASE_URL_MISSING: ${config.id}`)
    }

    // Use raw fetch instead of SDK to handle varying response formats across gateways
    const baseUrl = config.baseUrl.replace(/\/+$/, '')
    const pollUrl = `${baseUrl}/videos/${encodeURIComponent(videoId)}`
    const response = await fetch(pollUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${config.apiKey}` },
    })

    if (!response.ok) {
        const text = await response.text().catch(() => '')
        throw new Error(`OPENAI_VIDEO_POLL_FAILED: ${response.status} ${text.slice(0, 200)}`)
    }

    const task = await response.json() as Record<string, unknown>
    const status = typeof task.status === 'string' ? task.status : ''

    // Pending statuses: OpenAI uses "queued"/"in_progress", some gateways use "processing"
    if (status === 'queued' || status === 'in_progress' || status === 'processing') {
        return { status: 'pending' }
    }

    if (status === 'failed') {
        const errorObj = task.error as Record<string, unknown> | undefined
        const message = (typeof errorObj?.message === 'string' ? errorObj.message : '')
            || (typeof task.error === 'string' ? task.error : '')
            || `OpenAI video task failed: ${videoId}`
        return { status: 'failed', error: message }
    }

    if (status !== 'completed') {
        // Unknown status, treat as pending
        return { status: 'pending' }
    }

    // Completed: prefer video_url from response body (some gateways provide it directly)
    const videoUrl = typeof task.video_url === 'string' ? task.video_url.trim() : ''
    if (videoUrl) {
        return {
            status: 'completed',
            videoUrl,
            resultUrl: videoUrl,
        }
    }

    // Fallback: OpenAI standard /videos/:id/content endpoint
    const taskId = typeof task.id === 'string' ? task.id : videoId
    const contentUrl = `${baseUrl}/videos/${encodeURIComponent(taskId)}/content`
    return {
        status: 'completed',
        videoUrl: contentUrl,
        resultUrl: contentUrl,
        downloadHeaders: {
            Authorization: `Bearer ${config.apiKey}`,
        },
    }
}

/**
 * FAL task polling
 */
async function pollFalTask(
    endpoint: string,
    requestId: string,
    userId: string
): Promise<PollResult> {
    const { apiKey } = await getProviderConfig(userId, 'fal')
    const result = await queryFalStatus(endpoint, requestId, apiKey)

    return {
        status: result.completed ? (result.failed ? 'failed' : 'completed') : 'pending',
        resultUrl: result.resultUrl,
        imageUrl: result.resultUrl,
        videoUrl: result.resultUrl,
        error: result.error
    }
}

/**
 * Ark task polling
 */
async function pollArkTask(
    taskId: string,
    userId: string
): Promise<PollResult> {
    const { apiKey } = await getProviderConfig(userId, 'ark')
    const result = await querySeedanceVideoStatus(taskId, apiKey)

    return {
        status: result.status,
        videoUrl: result.videoUrl,
        resultUrl: result.videoUrl,
        error: result.error
    }
}

/**
 * Gemini Batch task polling
 */
async function pollGeminiTask(
    batchName: string,
    userId: string
): Promise<PollResult> {
    const { apiKey } = await getProviderConfig(userId, 'google')
    const result = await queryGeminiBatchStatus(batchName, apiKey)

    return {
        status: result.status,
        imageUrl: result.imageUrl,
        resultUrl: result.imageUrl,
        error: result.error
    }
}

/**
 * Google Veo video task polling
 */
async function pollGoogleVideoTask(
    operationName: string,
    userId: string
): Promise<PollResult> {
    const { apiKey } = await getProviderConfig(userId, 'google')
    const result = await queryGoogleVideoStatus(operationName, apiKey)

    return {
        status: result.status,
        videoUrl: result.videoUrl,
        resultUrl: result.videoUrl,
        error: result.error
    }
}

/**
 * MiniMax task polling
 */
async function pollMinimaxTask(
    taskId: string,
    userId: string
): Promise<PollResult> {
    const { apiKey } = await getProviderConfig(userId, 'minimax')
    const result = await queryMinimaxTaskStatus(taskId, apiKey)

    return {
        status: result.status,
        videoUrl: result.videoUrl,
        imageUrl: result.imageUrl,
        resultUrl: result.videoUrl || result.imageUrl,
        error: result.error
    }
}

/**
 * Query MiniMax task status
 */
async function queryMinimaxTaskStatus(
    taskId: string,
    apiKey: string
): Promise<{ status: 'pending' | 'completed' | 'failed'; videoUrl?: string; imageUrl?: string; error?: string }> {
    const logPrefix = '[MiniMax Query]'

    try {
        const response = await fetch(`https://api.minimaxi.com/v1/query/video_generation?task_id=${taskId}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`
            }
        })

        if (!response.ok) {
            const errorText = await response.text()
            _ulogError(`${logPrefix} Query failed:`, response.status, errorText)
            return {
                status: 'failed',
                error: `Query failed: ${response.status}`
            }
        }

        const data = await response.json()

        // 检查响应
        if (data.base_resp?.status_code !== 0) {
            const errMsg = data.base_resp?.status_msg || 'Unknown error'
            _ulogError(`${logPrefix} task_id=${taskId} error:`, errMsg)
            return {
                status: 'failed',
                error: errMsg
            }
        }

        const status = data.status

        if (status === 'Success') {
            const fileId = data.file_id
            if (!fileId) {
                _ulogError(`${logPrefix} task_id=${taskId} success but no file_id`)
                return {
                    status: 'failed',
                    error: 'Task completed but no video returned'
                }
            }

            // Use file_id to call file retrieve API for download URL
            _ulogInfo(`${logPrefix} task_id=${taskId} complete, fetching download URL...`)
            try {
                const fileResponse = await fetch(`https://api.minimaxi.com/v1/files/retrieve?file_id=${fileId}`, {
                    headers: {
                        'Authorization': `Bearer ${apiKey}`
                    }
                })

                if (!fileResponse.ok) {
                    const errorText = await fileResponse.text()
                    _ulogError(`${logPrefix} File retrieve failed:`, fileResponse.status, errorText)
                    return {
                        status: 'failed',
                        error: `File retrieve failed: ${fileResponse.status}`
                    }
                }

                const fileData = await fileResponse.json()
                const downloadUrl = fileData.file?.download_url

                if (!downloadUrl) {
                    _ulogError(`${logPrefix} File retrieve success but no download_url:`, fileData)
                    return {
                        status: 'failed',
                        error: 'Cannot get video download URL'
                    }
                }

                _ulogInfo(`${logPrefix} Got download URL: ${downloadUrl.substring(0, 80)}...`)
                return {
                    status: 'completed',
                    videoUrl: downloadUrl
                }
            } catch (error: unknown) {
                const errorMessage = getErrorMessage(error)
                _ulogError(`${logPrefix} File retrieve exception:`, error)
                return {
                    status: 'failed',
                    error: `File retrieve failed: ${errorMessage}`
                }
            }
        } else if (status === 'Failed') {
            const errMsg = data.error_message || 'Generation failed'
            _ulogError(`${logPrefix} task_id=${taskId} failed:`, errMsg)
            return {
                status: 'failed',
                error: errMsg
            }
        } else {
            // Processing or other status treated as pending
            return {
                status: 'pending'
            }
        }
    } catch (error: unknown) {
        const errorMessage = getErrorMessage(error)
        _ulogError(`${logPrefix} task_id=${taskId} 异常:`, error)
        return {
            status: 'failed',
            error: errorMessage
        }
    }
}

/**
 * Vidu 任务轮询
 */
async function pollViduTask(
    taskId: string,
    userId: string
): Promise<PollResult> {
    _ulogInfo(`[Poll Vidu] Starting poll task_id=${taskId}, userId=${userId}`)

    const { apiKey } = await getProviderConfig(userId, 'vidu')
    _ulogInfo(`[Poll Vidu] API Key length: ${apiKey?.length || 0}`)

    const result = await queryViduTaskStatus(taskId, apiKey)
    _ulogInfo(`[Poll Vidu] Query result:`, result)

    return {
        status: result.status,
        videoUrl: result.videoUrl,
        resultUrl: result.videoUrl,
        error: result.error
    }
}

/**
 * Query Vidu task status
 */
async function queryViduTaskStatus(
    taskId: string,
    apiKey: string
): Promise<{ status: 'pending' | 'completed' | 'failed'; videoUrl?: string; error?: string }> {
    const logPrefix = '[Vidu Query]'

    try {
        _ulogInfo(`${logPrefix} Query task task_id=${taskId}`)

        // Correct query path: /tasks/{id}/creations
        const response = await fetch(`https://api.vidu.cn/ent/v2/tasks/${taskId}/creations`, {
            headers: {
                'Authorization': `Token ${apiKey}`
            }
        })

        _ulogInfo(`${logPrefix} HTTP status: ${response.status}`)

        if (!response.ok) {
            const errorText = await response.text()
            _ulogError(`${logPrefix} Query failed:`, response.status, errorText)
            return {
                status: 'failed',
                error: `Vidu: Query failed ${response.status}`
            }
        }

        const data = await response.json()
        _ulogInfo(`${logPrefix} Response:`, JSON.stringify(data, null, 2))

        // Check task status
        const state = data.state

        if (state === 'success') {
            // Task success, get video URL from creations array
            const creations = data.creations
            if (!creations || creations.length === 0) {
                _ulogError(`${logPrefix} task_id=${taskId} success but no creations`)
                return {
                    status: 'failed',
                    error: 'Vidu: Task completed but no video returned'
                }
            }

            const videoUrl = creations[0].url
            if (!videoUrl) {
                _ulogError(`${logPrefix} task_id=${taskId} success but creation has no URL`)
                return {
                    status: 'failed',
                    error: 'Vidu: Task completed but no video URL returned'
                }
            }

            _ulogInfo(`${logPrefix} task_id=${taskId} complete, video URL: ${videoUrl.substring(0, 80)}...`)
            return {
                status: 'completed',
                videoUrl: videoUrl
            }
        } else if (state === 'failed') {
            // Use err_code as error message, add Vidu: prefix for error mapping
            const errCode = data.err_code || 'Unknown'
            _ulogError(`${logPrefix} task_id=${taskId} failed: ${errCode}`)
            return {
                status: 'failed',
                error: `Vidu: ${errCode}`  // 添加前缀以便错误映射识别
            }
        } else {
            // created, queueing, processing all treated as pending
            return {
                status: 'pending'
            }
        }
    } catch (error: unknown) {
        const errorMessage = getErrorMessage(error)
        _ulogError(`${logPrefix} task_id=${taskId} 异常:`, error)
        return {
            status: 'failed',
            error: `Vidu: ${errorMessage}`  // Add prefix for error mapping
        }
    }
}

// ==================== Format helpers ====================

/**
 * Create standard format externalId
 */
export function formatExternalId(
    provider: 'FAL' | 'ARK' | 'GEMINI' | 'GOOGLE' | 'MINIMAX' | 'VIDU' | 'OPENAI',
    type: 'VIDEO' | 'IMAGE' | 'BATCH',
    requestId: string,
    endpoint?: string,
    providerToken?: string,
): string {
    if (provider === 'FAL') {
        if (!endpoint) {
            throw new Error('FAL externalId requires endpoint')
        }
        return `FAL:${type}:${endpoint}:${requestId}`
    }
    if (provider === 'OPENAI') {
        if (!providerToken) {
            throw new Error('OPENAI externalId requires providerToken')
        }
        return `OPENAI:${type}:${providerToken}:${requestId}`
    }
    return `${provider}:${type}:${requestId}`
}
