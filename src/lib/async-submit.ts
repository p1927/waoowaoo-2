import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
/**
 * Async task submission utilities
 *
 * Core features:
 * 1. Submit tasks to external platforms (FAL/Ark)
 * 2. Query task status
 * 3. Download and save results
 */

// Note: API Key is now passed via parameters, no longer uses env vars

// ==================== FAL Queue Mode ====================

/**
 * Submit FAL task to queue
 * @param endpoint FAL endpoint, e.g. 'wan/v2.6/image-to-video'
 * @param input Request parameters
 * @param apiKey FAL API Key
 * @returns request_id
 */
export async function submitFalTask(endpoint: string, input: Record<string, unknown>, apiKey: string): Promise<string> {
    if (!apiKey) {
        throw new Error('Please configure FAL API Key')
    }

    const response = await fetch(`https://queue.fal.run/${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Key ${apiKey}`
        },
        body: JSON.stringify(input)
    })

    if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`FAL submit failed (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const requestId = data.request_id

    if (!requestId) {
        throw new Error('FAL did not return request_id')
    }

    _ulogInfo(`[FAL Queue] Task submitted: ${requestId}`)
    return requestId
}

/**
 * Parse FAL endpoint ID
 * Per official client logic, endpoint format: owner/alias/path
 * e.g. fal-ai/veo3.1/fast/image-to-video
 *   -> owner = fal-ai
 *   -> alias = veo3.1
 *   -> path = fast/image-to-video (ignored during status query)
 */
function parseFalEndpointId(endpoint: string): { owner: string; alias: string; path?: string } {
    const parts = endpoint.split('/')
    return {
        owner: parts[0],
        alias: parts[1],
        path: parts.slice(2).join('/') || undefined
    }
}

/**
 * Query FAL task status
 * @param endpoint FAL endpoint
 * @param requestId Task ID
 * @param apiKey FAL API Key
 */
export async function queryFalStatus(endpoint: string, requestId: string, apiKey: string): Promise<{
    status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'
    completed: boolean
    failed: boolean
    resultUrl?: string
    error?: string
}> {
    if (!apiKey) {
        throw new Error('Please configure FAL API Key')
    }

    // Per FAL official client logic: parse endpoint ID
    // Endpoint format: owner/alias/path (path ignored during status query)
    // e.g. fal-ai/veo3.1/fast/image-to-video -> fal-ai/veo3.1
    const parsed = parseFalEndpointId(endpoint)
    const baseEndpoint = `${parsed.owner}/${parsed.alias}`

    if (parsed.path) {
        _ulogInfo(`[FAL Status] Parsed endpoint ${endpoint} -> ${baseEndpoint} (ignored path: ${parsed.path})`)
    }

    const statusUrl = `https://queue.fal.run/${baseEndpoint}/requests/${requestId}/status?logs=0`

    // FAL status query uses GET method
    const response = await fetch(statusUrl, {
        method: 'GET',
        headers: {
            'Authorization': `Key ${apiKey}`
        }
    })

    if (!response.ok) {
        return {
            status: 'IN_PROGRESS',
            completed: false,
            failed: false
        }
    }

    const data = await response.json()
    const status = data.status as 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED'

    // Diagnostic log: see actual status returned by FAL
    _ulogInfo(`[FAL Status] requestId=${requestId.slice(0, 16)}... status=${status}`)

    if (status === 'COMPLETED') {
        // Try to get full result
        // Prefer response_url from response, otherwise build URL
        // Note: Must use full original endpoint (including /edit etc.) for result fetch, not baseEndpoint
        // Otherwise FAL treats request as new task, causing 422 error (missing required params like image_urls)
        const resultUrl = data.response_url || `https://queue.fal.run/${endpoint}/requests/${requestId}`
        _ulogInfo(`[FAL Status] Task completed, fetching result: ${resultUrl}`)

        const resultResponse = await fetch(resultUrl, {
            method: 'GET',
            headers: {
                'Authorization': `Key ${apiKey}`,
                'Accept': 'application/json'
            }
        })

        if (resultResponse.ok) {
            const resultData = await resultResponse.json()

            // Extract URL by type
            const videoUrl = resultData.video?.url
            const audioUrl = resultData.audio?.url
            const imageUrl = resultData.images?.[0]?.url

            _ulogInfo(`[FAL Status] Result fetched successfully: video=${!!videoUrl}, audio=${!!audioUrl}, image=${!!imageUrl}`)

            return {
                status: 'COMPLETED',
                completed: true,
                failed: false,
                resultUrl: videoUrl || audioUrl || imageUrl
            }
        } else {
            // Result fetch failed, log detailed error
            const errorText = await resultResponse.text()
            _ulogError(`[FAL Status] Result fetch failed (${resultResponse.status}): ${errorText.slice(0, 300)}`)

            // 422 may indicate content policy rejection or expired result
            if (resultResponse.status === 422) {
                // Try to parse specific error type
                let errorMessage = 'Unable to fetch result'
                try {
                    const errorJson = JSON.parse(errorText)
                    const errorType = errorJson.detail?.[0]?.type
                    if (errorType === 'content_policy_violation') {
                        errorMessage = 'Content policy violation: generated result was blocked'
                    } else if (errorType) {
                        errorMessage = `FAL error: ${errorType}`
                    }
                } catch { }

                _ulogError(`[FAL Status] 422 error: ${errorMessage}`)
                return {
                    status: 'COMPLETED',
                    completed: true,
                    failed: true,
                    error: errorMessage
                }
            }

            // 500 downstream service error, mark as failed to avoid infinite retry
            if (resultResponse.status === 500) {
                // Try to parse error details
                let errorDetail = 'Downstream service error'
                try {
                    const errorJson = JSON.parse(errorText)
                    if (errorJson.detail?.[0]?.type === 'downstream_service_error') {
                        errorDetail = 'FAL downstream service error: upstream model processing failed'
                    }
                } catch { }

                _ulogError(`[FAL Status] 500 error, marking task as failed: ${errorDetail}`)
                return {
                    status: 'COMPLETED',
                    completed: true,
                    failed: true,
                    error: errorDetail
                }
            }

            // Other errors, return in-progress for next poll retry
            return {
                status: 'IN_PROGRESS',
                completed: false,
                failed: false
            }
        }
    }

    if (status === 'FAILED') {
        return {
            status: 'FAILED',
            completed: false,
            failed: true,
            error: data.error || '任务失败'
        }
    }

    return {
        status,
        completed: false,
        failed: false
    }
}

// ==================== Ark 视频任务 ====================

/**
 * 查询Ark视频任务状态
 * @param taskId Ark任务ID
 * @param apiKey ARK API Key
 */
export async function queryArkVideoStatus(taskId: string, apiKey: string): Promise<{
    status: string
    completed: boolean
    failed: boolean
    resultUrl?: string
    error?: string
}> {
    if (!apiKey) {
        throw new Error('请配置火山引擎 API Key')
    }

    const response = await fetch(
        `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${taskId}`,
        {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            }
        }
    )

    if (!response.ok) {
        return {
            status: 'unknown',
            completed: false,
            failed: false
        }
    }

    const data = await response.json()
    const status = data.status

    if (status === 'succeeded') {
        return {
            status: 'succeeded',
            completed: true,
            failed: false,
            resultUrl: data.content?.video_url
        }
    }

    if (status === 'failed') {
        const errorObj = data.error || {}
        let errorMessage = errorObj.message || '任务失败'

        // 友好的错误信息
        if (errorObj.code === 'OutputVideoSensitiveContentDetected') {
            errorMessage = '视频生成失败：内容审核未通过'
        } else if (errorObj.code === 'InputImageSensitiveContentDetected') {
            errorMessage = '视频生成失败：输入图片审核未通过'
        }

        return {
            status: 'failed',
            completed: false,
            failed: true,
            error: errorMessage
        }
    }

    return {
        status,
        completed: false,
        failed: false
    }
}

// ==================== 通用接口 ====================

export type AsyncTaskProvider = 'fal' | 'ark'
export type AsyncTaskType = 'video' | 'image' | 'tts' | 'lipsync'

/**
 * 统一查询任务状态
 * @param provider 服务提供商
 * @param taskId 任务ID
 * @param apiKey API Key
 * @param endpoint FAL端点（仅FAL需要）
 */
export async function queryAsyncTaskStatus(
    provider: AsyncTaskProvider,
    taskId: string,
    apiKey: string,
    endpoint?: string
): Promise<{
    status: string
    completed: boolean
    failed: boolean
    resultUrl?: string
    error?: string
}> {
    if (provider === 'fal' && endpoint) {
        return queryFalStatus(endpoint, taskId, apiKey)
    } else if (provider === 'ark') {
        return queryArkVideoStatus(taskId, apiKey)
    }

    return {
        status: 'unknown',
        completed: false,
        failed: false
    }
}
