import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'

interface SelectImageBody {
    type?: 'character' | 'location'
    id?: string
    appearanceIndex?: number
    imageIndex?: number
    confirm?: boolean
}

interface GlobalCharacterAppearanceRecord {
    id: string
    imageUrls: string | null
    selectedIndex: number | null
}

interface GlobalLocationImageRecord {
    id: string
    imageIndex: number
}

interface GlobalLocationRecord {
    images?: GlobalLocationImageRecord[]
}

interface AssetHubSelectDb {
    globalCharacterAppearance: {
        findFirst(args: Record<string, unknown>): Promise<GlobalCharacterAppearanceRecord | null>
        update(args: Record<string, unknown>): Promise<unknown>
    }
    globalLocation: {
        findFirst(args: Record<string, unknown>): Promise<GlobalLocationRecord | null>
    }
    globalLocationImage: {
        updateMany(args: Record<string, unknown>): Promise<unknown>
        update(args: Record<string, unknown>): Promise<unknown>
    }
}

/**
 * POST /api/asset-hub/select-image
 * 选择/确认图片方案
 */
export const POST = apiHandler(async (request: NextRequest) => {
    const db = prisma as unknown as AssetHubSelectDb
    // Auth check
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = (await request.json()) as SelectImageBody
    const { type, id, appearanceIndex, imageIndex, confirm } = body

    if (type === 'character') {
        const appearance = await db.globalCharacterAppearance.findFirst({
            where: {
                characterId: id,
                appearanceIndex: appearanceIndex ?? PRIMARY_APPEARANCE_INDEX,
                character: { userId: session.user.id }
            }
        })

        if (!appearance) {
            throw new ApiError('NOT_FOUND')
        }

        // 如果是确认选择，将 selectedIndex 对应的图片设置为 imageUrl
        if (confirm && appearance.selectedIndex !== null) {
            const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'globalCharacterAppearance.imageUrls')
            const selectedUrl = imageUrls[appearance.selectedIndex]

            if (selectedUrl) {
                await db.globalCharacterAppearance.update({
                    where: { id: appearance.id },
                    data: {
                        imageUrl: selectedUrl,
                        imageUrls: encodeImageUrls([selectedUrl]), // Keep only selected images
                        selectedIndex: 0
                    }
                })
            }
        } else {
            // 只是选择，不确认
            await db.globalCharacterAppearance.update({
                where: { id: appearance.id },
                data: { selectedIndex: imageIndex }
            })
        }

        return NextResponse.json({ success: true })

    } else if (type === 'location') {
        const location = await db.globalLocation.findFirst({
            where: { id, userId: session.user.id },
            include: { images: true }
        })

        if (!location) {
            throw new ApiError('NOT_FOUND')
        }

        // Update selected state
        await db.globalLocationImage.updateMany({
            where: { locationId: id },
            data: { isSelected: false }
        })

        if (imageIndex !== null && imageIndex !== undefined) {
            const targetImage = location.images?.find((img) => img.imageIndex === imageIndex)
            if (targetImage) {
                await db.globalLocationImage.update({
                    where: { id: targetImage.id },
                    data: { isSelected: true }
                })
            }
        }

        return NextResponse.json({ success: true })

    } else {
        throw new ApiError('INVALID_PARAMS')
    }
})
