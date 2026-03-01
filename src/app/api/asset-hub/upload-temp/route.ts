import { NextRequest, NextResponse } from 'next/server'
import { generateUniqueKey, getSignedUrl, uploadToCOS } from '@/lib/cos'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST /api/asset-hub/upload-temp
 * Upload temp file (Base64), return signed URL
 * Supports image and audio
 */
export const POST = apiHandler(async (request: NextRequest) => {
    // Auth check
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = await request.json()
    const { imageBase64, base64, extension } = body

    // Two modes:
    // 1. Image: { imageBase64: "data:image/..." }
    // 2. Generic: { base64, type, extension }

    let buffer: Buffer
    let ext: string

    if (imageBase64) {
        // Image mode
        const matches = imageBase64.match(/^data:image\/(\w+);base64,(.+)$/)
        if (!matches) {
            throw new ApiError('INVALID_PARAMS')
        }
        ext = matches[1] === 'jpeg' ? 'jpg' : matches[1]
        buffer = Buffer.from(matches[2], 'base64')
    } else if (base64 && extension) {
        // Generic (audio etc)
        buffer = Buffer.from(base64, 'base64')
        ext = extension
    } else {
        throw new ApiError('INVALID_PARAMS')
    }

    // Upload to COS
    const key = generateUniqueKey(`temp-${session.user.id}-${Date.now()}`, ext)
    await uploadToCOS(buffer, key)

    // Return signed URL (1h TTL)
    const signedUrl = getSignedUrl(key, 3600)

    return NextResponse.json({
        success: true,
        url: signedUrl,
        key
    })
})
