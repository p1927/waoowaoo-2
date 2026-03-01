import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

/**
 * GET - Get project assets (characters + locations)
 * V6.5: Unified assets API for useProjectAssets hook
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // Auth check
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    // Get project characters and locations
    const novelData = await prisma.novelPromotionProject.findUnique({
        where: { projectId },
        include: {
            characters: {
                include: {
                    appearances: {
                        orderBy: { appearanceIndex: 'asc' }
                    }
                },
                orderBy: { createdAt: 'asc' }
            },
            locations: {
                include: {
                    images: {
                        orderBy: { imageIndex: 'asc' }
                    }
                },
                orderBy: { createdAt: 'asc' }
            }
        }
    })

    if (!novelData) {
        return NextResponse.json({ characters: [], locations: [] })
    }

    // Add stable media URL to assets (keep compat)
    const withSignedUrls = await attachMediaFieldsToProject(novelData)

    return NextResponse.json({
        characters: withSignedUrls.characters || [],
        locations: withSignedUrls.locations || []
    })
})
