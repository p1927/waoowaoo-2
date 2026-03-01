import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest } from 'next/server'
import { getSignedUrl, toFetchableUrl } from '@/lib/cos'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * Proxy download single video file
 * Resolves COS cross-origin download issues
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params
    const { searchParams } = new URL(request.url)
    const videoKey = searchParams.get('key')

    if (!videoKey) {
        throw new ApiError('INVALID_PARAMS')
    }

    // Auth verification
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    // Generate signed URL and download
    let fetchUrl: string
    if (videoKey.startsWith('http://') || videoKey.startsWith('https://')) {
        fetchUrl = videoKey
    } else {
        fetchUrl = toFetchableUrl(getSignedUrl(videoKey, 3600))
    }

    _ulogInfo(`[Video proxy] Download: ${fetchUrl.substring(0, 100)}...`)

    const response = await fetch(fetchUrl)
    if (!response.ok) {
        throw new Error(`Failed to fetch video: ${response.statusText}`)
    }

    // Get content type and length
    const contentType = response.headers.get('content-type') || 'video/mp4'
    const contentLength = response.headers.get('content-length')

    // Stream video data response
    const headers: HeadersInit = {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache'
    }
    if (contentLength) {
        headers['Content-Length'] = contentLength
    }

    return new Response(response.body, { headers })
})
