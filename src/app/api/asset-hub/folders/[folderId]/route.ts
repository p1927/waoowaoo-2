import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// Update folder
export const PATCH = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ folderId: string }> }
) => {
    const { folderId } = await context.params

    // Auth check
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = await request.json()
    const { name } = body

    if (!name?.trim()) {
        throw new ApiError('INVALID_PARAMS')
    }

    // Verify ownership
    const folder = await prisma.globalAssetFolder.findUnique({
        where: { id: folderId }
    })

    if (!folder || folder.userId !== session.user.id) {
        throw new ApiError('FORBIDDEN')
    }

    const updatedFolder = await prisma.globalAssetFolder.update({
        where: { id: folderId },
        data: { name: name.trim() }
    })

    return NextResponse.json({ success: true, folder: updatedFolder })
})

// Delete folder
export const DELETE = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ folderId: string }> }
) => {
    const { folderId } = await context.params

    // Auth check
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    // Verify ownership
    const folder = await prisma.globalAssetFolder.findUnique({
        where: { id: folderId }
    })

    if (!folder || folder.userId !== session.user.id) {
        throw new ApiError('FORBIDDEN')
    }

    // Before delete, move folder assets to root (folderId = null)
    await prisma.globalCharacter.updateMany({
        where: { folderId },
        data: { folderId: null }
    })

    await prisma.globalLocation.updateMany({
        where: { folderId },
        data: { folderId: null }
    })

    // Delete folder
    await prisma.globalAssetFolder.delete({
        where: { id: folderId }
    })

    return NextResponse.json({ success: true })
})
