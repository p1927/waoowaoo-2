import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'

function toObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return value as Record<string, unknown>
}

/**
 * POST /api/novel-promotion/[projectId]/generate-character-image
 * Simplified API to trigger character image generation
 * Internal: call generate-image API
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // Auth check
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json()
    const taskLocale = resolveTaskLocale(request, body)
    const bodyMeta = toObject((body as Record<string, unknown>).meta)
    const acceptLanguage = request.headers.get('accept-language') || ''
    const { characterId, appearanceId, artStyle } = body

    if (!characterId) {
        throw new ApiError('INVALID_PARAMS')
    }

    // If no appearanceId, get first appearance id
    let targetAppearanceId = appearanceId
    if (!targetAppearanceId) {
        const character = await prisma.novelPromotionCharacter.findUnique({
            where: { id: characterId },
            include: { appearances: { orderBy: { appearanceIndex: 'asc' } } }
        })
        if (!character) {
            throw new ApiError('NOT_FOUND')
        }
        const firstAppearance = character.appearances?.[0]
        if (!firstAppearance) {
            throw new ApiError('NOT_FOUND')
        }
        targetAppearanceId = firstAppearance.id
    }

    // If artStyle set, update novelPromotionProject for generate-image
    if (artStyle) {
        const novelData = await prisma.novelPromotionProject.findUnique({ where: { projectId } })
        if (novelData) {
            // Map style to prompt
            const ART_STYLES = [
                { value: 'american-comic', prompt: 'American comic style' },
                { value: 'chinese-comic', prompt: 'Refined comic style' },
                { value: 'anime', prompt: 'Anime style' },
                { value: 'realistic', prompt: 'Photorealistic style' }
            ]
            const style = ART_STYLES.find(s => s.value === artStyle)
            if (style) {
                await prisma.novelPromotionProject.update({
                    where: { id: novelData.id },
                    data: { artStylePrompt: style.prompt }
                })
            }
        }
    }

    // Call generate-image API
    const { getBaseUrl } = await import('@/lib/env')
    const baseUrl = getBaseUrl()
    const generateRes = await fetch(`${baseUrl}/api/novel-promotion/${projectId}/generate-image`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': request.headers.get('cookie') || '',
            ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {})
        },
        body: JSON.stringify({
            type: 'character',
            id: characterId,
            appearanceId: targetAppearanceId,  // Use actual UUID
            locale: taskLocale || undefined,
            meta: {
                ...bodyMeta,
                locale: taskLocale || bodyMeta.locale || undefined,
            },
        })
    })

    const result = await generateRes.json()

    if (!generateRes.ok) {
        _ulogError('[Generate Character Image] failed:', result.error)
        throw new ApiError('GENERATION_FAILED')
    }

    return NextResponse.json(result)
})
