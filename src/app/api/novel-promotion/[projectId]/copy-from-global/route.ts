import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { updateCharacterAppearanceLabels, updateLocationImageLabels } from '@/lib/image-label'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface GlobalCharacterAppearanceSource {
    appearanceIndex: number
    changeReason: string
    description: string | null
    descriptions: string | null
    imageUrl: string | null
    imageUrls: string | null
    selectedIndex: number | null
}

interface GlobalCharacterSource {
    name: string
    voiceId: string | null
    voiceType: string | null
    customVoiceUrl: string | null
    appearances: GlobalCharacterAppearanceSource[]
}

interface GlobalLocationImageSource {
    imageIndex: number
    description: string | null
    imageUrl: string | null
    isSelected: boolean
}

interface GlobalLocationSource {
    name: string
    summary: string | null
    images: GlobalLocationImageSource[]
}

interface GlobalVoiceSource {
    name: string
    voiceId: string | null
    voiceType: string | null
    customVoiceUrl: string | null
}

interface CopyFromGlobalDb {
    globalCharacter: {
        findFirst(args: Record<string, unknown>): Promise<GlobalCharacterSource | null>
    }
    globalLocation: {
        findFirst(args: Record<string, unknown>): Promise<GlobalLocationSource | null>
    }
    globalVoice: {
        findFirst(args: Record<string, unknown>): Promise<GlobalVoiceSource | null>
    }
}

/**
 * POST /api/novel-promotion/[projectId]/copy-from-global
 * Copy character/location appearance data from asset center to project assets
 *
 * Copy (not reference): project assets are unaffected even if global assets are deleted
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params
    const db = prisma as unknown as CopyFromGlobalDb

    // Auth verification
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    const session = authResult.session

    const body = await request.json()
    const { type, targetId, globalAssetId } = body

    if (!type || !targetId || !globalAssetId) {
        throw new ApiError('INVALID_PARAMS')
    }

    if (type === 'character') {
        return await copyCharacterFromGlobal(db, session.user.id, targetId, globalAssetId)
    } else if (type === 'location') {
        return await copyLocationFromGlobal(db, session.user.id, targetId, globalAssetId)
    } else if (type === 'voice') {
        return await copyVoiceFromGlobal(db, session.user.id, targetId, globalAssetId)
    } else {
        throw new ApiError('INVALID_PARAMS')
    }
})

/**
 * Copy global character appearance to project character
 */
async function copyCharacterFromGlobal(db: CopyFromGlobalDb, userId: string, targetId: string, globalCharacterId: string) {
    _ulogInfo(`[Copy from Global] Copy character: global=${globalCharacterId} -> project=${targetId}`)

    // 1. Fetch global character and appearances
    const globalCharacter = await db.globalCharacter.findFirst({
        where: { id: globalCharacterId, userId },
        include: { appearances: true }
    })

    if (!globalCharacter) {
        throw new ApiError('NOT_FOUND')
    }

    // 2. Fetch project character
    const projectCharacter = await prisma.novelPromotionCharacter.findUnique({
        where: { id: targetId },
        include: { appearances: true }
    })

    if (!projectCharacter) {
        throw new ApiError('NOT_FOUND')
    }

    // 3. Delete project character's old appearances
    if (projectCharacter.appearances.length > 0) {
        await prisma.characterAppearance.deleteMany({
            where: { characterId: targetId }
        })
        _ulogInfo(`[Copy from Global] Deleted ${projectCharacter.appearances.length} old appearances`)
    }

    // 4. Update black-bar labels: replace asset center character name with project character name
    _ulogInfo(`[Copy from Global] Update black-bar labels: ${globalCharacter.name} -> ${projectCharacter.name}`)
    const updatedLabels = await updateCharacterAppearanceLabels(
        globalCharacter.appearances.map((app) => ({
            imageUrl: app.imageUrl,
            imageUrls: encodeImageUrls(decodeImageUrlsFromDb(app.imageUrls, 'globalCharacterAppearance.imageUrls')),
            changeReason: app.changeReason
        })),
        projectCharacter.name
    )

    // 5. Copy global appearances to project (using updated image URLs)
    const copiedAppearances = []
    for (let i = 0; i < globalCharacter.appearances.length; i++) {
        const app = globalCharacter.appearances[i]
        const labelUpdate = updatedLabels[i]
        const originalImageUrls = decodeImageUrlsFromDb(app.imageUrls, 'globalCharacterAppearance.imageUrls')

        const newAppearance = await prisma.characterAppearance.create({
            data: {
                characterId: targetId,
                appearanceIndex: app.appearanceIndex,
                changeReason: app.changeReason,
                description: app.description,
                descriptions: app.descriptions,
                // Use new image URL with updated label
                imageUrl: labelUpdate?.imageUrl || app.imageUrl,
                imageUrls: labelUpdate?.imageUrls || encodeImageUrls(originalImageUrls),
                previousImageUrls: encodeImageUrls([]),
                selectedIndex: app.selectedIndex
            }
        })
        copiedAppearances.push(newAppearance)
    }
    _ulogInfo(`[Copy from Global] Copied ${copiedAppearances.length} appearances (labels updated)`)

    // 6. Update project character: record source ID and mark profile confirmed
    const updatedCharacter = await prisma.novelPromotionCharacter.update({
        where: { id: targetId },
        data: {
            sourceGlobalCharacterId: globalCharacterId,
            // Using existing appearance counts as profile confirmation
            profileConfirmed: true,
            // Optional: copy voice settings
            voiceId: globalCharacter.voiceId,
            voiceType: globalCharacter.voiceType,
            customVoiceUrl: globalCharacter.customVoiceUrl
        },
        include: { appearances: true }
    })

    _ulogInfo(`[Copy from Global] Character copy complete: ${projectCharacter.name}`)

    return NextResponse.json({
        success: true,
        character: updatedCharacter,
        copiedAppearancesCount: copiedAppearances.length
    })
}

/**
 * Copy global location images to project location
 */
async function copyLocationFromGlobal(db: CopyFromGlobalDb, userId: string, targetId: string, globalLocationId: string) {
    _ulogInfo(`[Copy from Global] Copy location: global=${globalLocationId} -> project=${targetId}`)

    // 1. Fetch global location and images
    const globalLocation = await db.globalLocation.findFirst({
        where: { id: globalLocationId, userId },
        include: { images: true }
    })

    if (!globalLocation) {
        throw new ApiError('NOT_FOUND')
    }

    // 2. Fetch project location
    const projectLocation = await prisma.novelPromotionLocation.findUnique({
        where: { id: targetId },
        include: { images: true }
    })

    if (!projectLocation) {
        throw new ApiError('NOT_FOUND')
    }

    // 3. Delete project location's old images
    if (projectLocation.images.length > 0) {
        await prisma.locationImage.deleteMany({
            where: { locationId: targetId }
        })
        _ulogInfo(`[Copy from Global] Deleted ${projectLocation.images.length} old images`)
    }

    // 4. Update black-bar labels: replace asset center location name with project location name
    _ulogInfo(`[Copy from Global] Update black-bar labels: ${globalLocation.name} -> ${projectLocation.name}`)
    const updatedLabels = await updateLocationImageLabels(
        globalLocation.images.map((img) => ({
            imageUrl: img.imageUrl
        })),
        projectLocation.name
    )

    // 5. Copy global images to project (using updated image URLs)
    const copiedImages: Array<{ id: string; imageIndex: number; imageUrl: string | null }> = []
    for (let i = 0; i < globalLocation.images.length; i++) {
        const img = globalLocation.images[i]
        const labelUpdate = updatedLabels[i]

        const newImage = await prisma.locationImage.create({
            data: {
                locationId: targetId,
                imageIndex: img.imageIndex,
                description: img.description,
                // Use new image URL with updated label
                imageUrl: labelUpdate?.imageUrl || img.imageUrl,
                isSelected: img.isSelected
            }
        })
        copiedImages.push(newImage)
    }
    _ulogInfo(`[Copy from Global] Copied ${copiedImages.length} images (labels updated)`)

    const selectedFromGlobal = globalLocation.images.find((img) => img.isSelected)
    const selectedImageId = selectedFromGlobal
        ? copiedImages.find(i => i.imageIndex === selectedFromGlobal.imageIndex)?.id
        : copiedImages.find(i => i.imageUrl)?.id || null
    await prisma.novelPromotionLocation.update({
        where: { id: targetId },
        data: { selectedImageId }
    })

    // 6. Update project location: record source ID and summary
    const updatedLocation = await prisma.novelPromotionLocation.update({
        where: { id: targetId },
        data: {
            sourceGlobalLocationId: globalLocationId,
            summary: globalLocation.summary
        },
        include: { images: true }
    })

    _ulogInfo(`[Copy from Global] Location copy complete: ${projectLocation.name}`)

    return NextResponse.json({
        success: true,
        location: updatedLocation,
        copiedImagesCount: copiedImages.length
    })
}

/**
 * Copy global voice to project character
 */
async function copyVoiceFromGlobal(db: CopyFromGlobalDb, userId: string, targetCharacterId: string, globalVoiceId: string) {
    _ulogInfo(`[Copy from Global] Copy voice: global=${globalVoiceId} -> project character=${targetCharacterId}`)

    // 1. Fetch global voice
    const globalVoice = await db.globalVoice.findFirst({
        where: { id: globalVoiceId, userId }
    })

    if (!globalVoice) {
        throw new ApiError('NOT_FOUND')
    }

    // 2. Fetch project character
    const projectCharacter = await prisma.novelPromotionCharacter.findUnique({
        where: { id: targetCharacterId }
    })

    if (!projectCharacter) {
        throw new ApiError('NOT_FOUND')
    }

    // 3. Update project character's voice settings
    const updatedCharacter = await prisma.novelPromotionCharacter.update({
        where: { id: targetCharacterId },
        data: {
            voiceId: globalVoice.voiceId,
            voiceType: globalVoice.voiceType,  // 'qwen-designed' | 'custom'
            customVoiceUrl: globalVoice.customVoiceUrl
        }
    })

    _ulogInfo(`[Copy from Global] Voice copy complete: ${projectCharacter.name} <- ${globalVoice.name}`)

    return NextResponse.json({
        success: true,
        character: updatedCharacter,
        voiceName: globalVoice.name
    })
}
