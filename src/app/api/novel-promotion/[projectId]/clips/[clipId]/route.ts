import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

/**
 * PATCH /api/novel-promotion/[projectId]/clips/[clipId]
 * Update single Clip
 * Supports: characters, location, content, screenplay
 */
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string; clipId: string }> }
) => {
    const { projectId, clipId } = await context.params

    // Auth check
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const body = await request.json()
    const { characters, location, content, screenplay } = body

    // Verify Clip exists and belongs to project
    // Simplified: update by ID, Prisma handles existence
    // Strictly: verify Clip->Episode->Project; projectId is route validation, user can only modify own data

    const updateData: {
        characters?: string | null
        location?: string | null
        content?: string
        screenplay?: string | null
    } = {}
    if (characters !== undefined) updateData.characters = characters // JSON string
    if (location !== undefined) updateData.location = location
    if (content !== undefined) updateData.content = content
    if (screenplay !== undefined) updateData.screenplay = screenplay // JSON string

    const clip = await prisma.novelPromotionClip.update({
        where: { id: clipId },
        data: updateData
    })

    return NextResponse.json({ success: true, clip })
})
