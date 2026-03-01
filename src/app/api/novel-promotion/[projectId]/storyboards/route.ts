import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

/**
 * GET /api/novel-promotion/[projectId]/storyboards
 * Get episode storyboard data (for test page)
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // Auth check
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const { searchParams } = new URL(request.url)
    const episodeId = searchParams.get('episodeId')

    if (!episodeId) {
        throw new ApiError('INVALID_PARAMS')
    }

    // Get episode storyboard data
    const storyboards = await prisma.novelPromotionStoryboard.findMany({
        where: { episodeId },
        include: {
            clip: true,
            panels: { orderBy: { panelIndex: 'asc' } }
        },
        orderBy: { createdAt: 'asc' }
    })

    const withMedia = await attachMediaFieldsToProject({ storyboards })
    const processedStoryboards = withMedia.storyboards || storyboards

    return NextResponse.json({ storyboards: processedStoryboards })
})

/**
 * PATCH /api/novel-promotion/[projectId]/storyboards
 * Clear storyboard lastError
 */
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // Auth check
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json().catch(() => ({}))
    const storyboardId = typeof body?.storyboardId === 'string' ? body.storyboardId : ''
    if (!storyboardId) {
        throw new ApiError('INVALID_PARAMS')
    }

    await prisma.novelPromotionStoryboard.update({
        where: { id: storyboardId },
        data: { lastError: null }})

    return NextResponse.json({ success: true })
})
