import { logError as _ulogError } from '@/lib/logging/core'
/**
 * Undo regenerated image, restore to previous version
 * POST /api/novel-promotion/[projectId]/undo-regenerate
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteCOSObject } from '@/lib/cos'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface CharacterAppearanceRecord {
    id: string
    imageUrl: string | null
    imageUrls: string | null
    previousImageUrl: string | null
    previousImageUrls: string | null
    description: string | null
    descriptions: unknown
    previousDescription: string | null
    previousDescriptions: unknown
}

interface LocationImageRecord {
    id: string
    imageUrl: string | null
    previousImageUrl: string | null
    description: string | null
    previousDescription: string | null
}

interface LocationRecord {
    images?: LocationImageRecord[]
}

interface PanelRecord {
    id: string
    imageUrl: string | null
    previousImageUrl: string | null
}

interface UndoRegenerateTx {
    characterAppearance: {
        update(args: Record<string, unknown>): Promise<unknown>
    }
    locationImage: {
        update(args: Record<string, unknown>): Promise<unknown>
    }
}

interface UndoRegenerateDb extends UndoRegenerateTx {
    characterAppearance: {
        findUnique(args: Record<string, unknown>): Promise<CharacterAppearanceRecord | null>
        update(args: Record<string, unknown>): Promise<unknown>
    }
    novelPromotionLocation: {
        findUnique(args: Record<string, unknown>): Promise<LocationRecord | null>
    }
    novelPromotionPanel: {
        findUnique(args: Record<string, unknown>): Promise<PanelRecord | null>
        update(args: Record<string, unknown>): Promise<unknown>
    }
    $transaction<T>(fn: (tx: UndoRegenerateTx) => Promise<T>): Promise<T>
}

export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params
    const db = prisma as unknown as UndoRegenerateDb

    // Auth verification
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    const { type, id, appearanceId } = await request.json()

    // UUID format validation helper
    const isValidUUID = (str: unknown): boolean => {
        if (typeof str !== 'string') return false
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        return uuidRegex.test(str)
    }

    if (!type || !id) {
        throw new ApiError('INVALID_PARAMS')
    }

    if (type === 'character') {
        // Verify appearanceId is valid UUID
        if (!appearanceId || !isValidUUID(appearanceId)) {
            _ulogError(`[undo-regenerate] Invalid appearanceId: ${appearanceId} (type: ${typeof appearanceId})`)
            throw new ApiError('INVALID_PARAMS')
        }
        return await undoCharacterRegenerate(db, appearanceId)
    } else if (type === 'location') {
        return await undoLocationRegenerate(db, id)
    } else if (type === 'panel') {
        return await undoPanelRegenerate(db, id)
    }

    throw new ApiError('INVALID_PARAMS')
})

async function undoCharacterRegenerate(db: UndoRegenerateDb, appearanceId: string) {
    // Query appearance by UUID
    const appearance = await db.characterAppearance.findUnique({
        where: { id: appearanceId },
        include: { character: true }
    })

    if (!appearance) {
        throw new ApiError('NOT_FOUND')
    }

    const previousImageUrls = decodeImageUrlsFromDb(appearance.previousImageUrls, 'characterAppearance.previousImageUrls')

    // Check if previous version exists
    if (!appearance.previousImageUrl && previousImageUrls.length === 0) {
        throw new ApiError('INVALID_PARAMS')
    }

    // Delete current image
    const currentImageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
    for (const key of currentImageUrls) {
        if (key) {
            try {
                const storageKey = await resolveStorageKeyFromMediaValue(key)
                if (storageKey) await deleteCOSObject(storageKey)
            } catch { }
        }
    }

    const restoredImageUrls = previousImageUrls.length > 0
        ? previousImageUrls
        : (appearance.previousImageUrl ? [appearance.previousImageUrl] : [])

    await db.$transaction(async (tx) => {
        await tx.characterAppearance.update({
            where: { id: appearance.id },
            data: {
                imageUrl: appearance.previousImageUrl || restoredImageUrls[0] || null,
                imageUrls: encodeImageUrls(restoredImageUrls),
                previousImageUrl: null,
                previousImageUrls: encodeImageUrls([]),
                selectedIndex: null,
                // Also restore description
                description: appearance.previousDescription ?? appearance.description,
                descriptions: appearance.previousDescriptions ?? appearance.descriptions,
                previousDescription: null,
                previousDescriptions: null
            }
        })
    })

    return NextResponse.json({
        success: true,
        message: 'Reverted to previous version (image and description)'
    })
}

async function undoLocationRegenerate(db: UndoRegenerateDb, locationId: string) {
    // Fetch location and images
    const location = await db.novelPromotionLocation.findUnique({
        where: { id: locationId },
        include: { images: { orderBy: { imageIndex: 'asc' } } }
    })

    if (!location) {
        throw new ApiError('NOT_FOUND')
    }

    // Check if previous version exists
    const hasPrevious = location.images?.some((img) => img.previousImageUrl)
    if (!hasPrevious) {
        throw new ApiError('INVALID_PARAMS')
    }

    // Delete current image and restore previous version
    await db.$transaction(async (tx) => {
        for (const img of location.images || []) {
            if (img.previousImageUrl) {
                // Delete current image
                if (img.imageUrl) {
                    try {
                        const storageKey = await resolveStorageKeyFromMediaValue(img.imageUrl)
                        if (storageKey) await deleteCOSObject(storageKey)
                    } catch { }
                }
                // Restore previous version (image + description)
                await tx.locationImage.update({
                    where: { id: img.id },
                    data: {
                        imageUrl: img.previousImageUrl,
                        previousImageUrl: null,
                        // Also restore description
                        description: img.previousDescription ?? img.description,
                        previousDescription: null
                    }
                })
            }
        }
    })

    return NextResponse.json({
        success: true,
        message: 'Reverted to previous version (image and description)'
    })
}

/**
 * Undo Panel shot image to previous version
 */
async function undoPanelRegenerate(db: UndoRegenerateDb, panelId: string) {
    // Fetch panel
    const panel = await db.novelPromotionPanel.findUnique({
        where: { id: panelId }
    })

    if (!panel) {
        throw new ApiError('NOT_FOUND')
    }

    // Check if previous version exists
    if (!panel.previousImageUrl) {
        throw new ApiError('INVALID_PARAMS')
    }

    // Delete current image (if exists)
    if (panel.imageUrl) {
        try {
            const storageKey = await resolveStorageKeyFromMediaValue(panel.imageUrl)
            if (storageKey) await deleteCOSObject(storageKey)
        } catch { }
    }

    // Restore previous version
    await db.novelPromotionPanel.update({
        where: { id: panelId },
        data: {
            imageUrl: panel.previousImageUrl,
            previousImageUrl: null,
            candidateImages: null  // Clear candidate images
        }
    })

    return NextResponse.json({
        success: true,
        message: 'Panel image reverted to previous version'
    })
}
