import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

/**
 * Lazy-load API - fetch project characters and locations assets
 * For asset management page, avoids performance cost on initial load
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // Auth verification
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    // Verify project ownership
    const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { userId: true }
    })

    if (!project) {
        throw new ApiError('NOT_FOUND')
    }

    if (project.userId !== session.user.id) {
        throw new ApiError('FORBIDDEN')
    }

    // Fetch characters and locations (with nested data)
    const novelPromotionData = await prisma.novelPromotionProject.findUnique({
        where: { projectId },
        include: {
            characters: {
                include: { appearances: { orderBy: { appearanceIndex: 'asc' } } },
                orderBy: { createdAt: 'asc' }
            },
            locations: {
                include: { images: { orderBy: { imageIndex: 'asc' } } },
                orderBy: { createdAt: 'asc' }
            }
        }
    })

    if (!novelPromotionData) {
        throw new ApiError('NOT_FOUND')
    }

    // Convert to stable media URLs (preserve compatible fields)
    const dataWithSignedUrls = await attachMediaFieldsToProject(novelPromotionData)

    return NextResponse.json({
        characters: dataWithSignedUrls.characters || [],
        locations: dataWithSignedUrls.locations || []
    })
})
