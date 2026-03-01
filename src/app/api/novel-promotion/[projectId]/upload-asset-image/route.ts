import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadToCOS, generateUniqueKey } from '@/lib/cos'
import sharp from 'sharp'
import { initializeFonts, createLabelSVG } from '@/lib/fonts'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface CharacterAppearanceRecord {
  id: string
  imageUrls: string | null
  selectedIndex: number | null
}

interface LocationImageRecord {
  id: string
  imageIndex: number
}

interface LocationRecord {
  selectedImageId: string | null
  images?: LocationImageRecord[]
}

interface UploadAssetImageDb {
  characterAppearance: {
    findUnique(args: Record<string, unknown>): Promise<CharacterAppearanceRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  novelPromotionLocation: {
    findUnique(args: Record<string, unknown>): Promise<LocationRecord | null>
    update(args: Record<string, unknown>): Promise<unknown>
  }
  locationImage: {
    update(args: Record<string, unknown>): Promise<{ id: string }>
    create(args: Record<string, unknown>): Promise<{ id: string }>
  }
}

/**
 * POST /api/novel-promotion/[projectId]/upload-asset-image
 * Upload user custom image as character or location asset
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const db = prisma as unknown as UploadAssetImageDb

  // Initialize fonts (required in Vercel env)
  await initializeFonts()

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  // Parse form data
  const formData = await request.formData()
  const file = formData.get('file') as File
  const type = formData.get('type') as string // 'character' | 'location'
  const id = formData.get('id') as string // characterId or locationId
  const appearanceId = formData.get('appearanceId') as string | null  // UUID
  const imageIndex = formData.get('imageIndex') as string | null
  const labelText = formData.get('labelText') as string // Label text

  if (!file || !type || !id || !labelText) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Read file
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Add label text
  const meta = await sharp(buffer).metadata()
  const w = meta.width || 2160
  const h = meta.height || 2160
  const fontSize = Math.floor(h * 0.04)
  const pad = Math.floor(fontSize * 0.5)
  const barH = fontSize + pad * 2

  // Create SVG label bar
  const svg = await createLabelSVG(w, barH, fontSize, pad, labelText)

  // Add label bar to image top
  const processed = await sharp(buffer)
    .extend({ top: barH, bottom: 0, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  // Generate unique key and upload
  const keyPrefix = type === 'character'
    ? `char-${id}-${appearanceId}-upload`
    : `loc-${id}-upload`
  const key = generateUniqueKey(keyPrefix, 'jpg')
  await uploadToCOS(processed, key)

  // Update database
  if (type === 'character' && appearanceId !== null) {
    // Update character appearance image - query by UUID
    const appearance = await db.characterAppearance.findUnique({
      where: { id: appearanceId }
    })

    if (!appearance) {
      throw new ApiError('NOT_FOUND')
    }

    // Parse existing image array
    const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')

    // If imageIndex specified, replace image at that position
    const targetIndex = imageIndex !== null ? parseInt(imageIndex) : imageUrls.length

    // Ensure array is large enough
    while (imageUrls.length <= targetIndex) {
      imageUrls.push('')
    }

    imageUrls[targetIndex] = key

    // Compute whether to sync update imageUrl
    // When uploaded image is selected, or first image when none selected
    const selectedIndex = appearance.selectedIndex
    const shouldUpdateImageUrl =
      selectedIndex === targetIndex ||  // Uploaded image is selected
      (selectedIndex === null && targetIndex === 0) ||  // No selection, uploaded is first
      imageUrls.filter(u => !!u).length === 1  // Only one valid image

    const updateData: Record<string, unknown> = {
      imageUrls: encodeImageUrls(imageUrls)
    }

    if (shouldUpdateImageUrl) {
      updateData.imageUrl = key
    }

    // 更新数据库
    await db.characterAppearance.update({
      where: { id: appearance.id },
      data: updateData
    })

    return NextResponse.json({
      success: true,
      imageKey: key,
      imageIndex: targetIndex
    })

  } else if (type === 'location') {
    // 更新场景图片
    const location = await db.novelPromotionLocation.findUnique({
      where: { id },
      include: { images: { orderBy: { imageIndex: 'asc' } } }
    })

    if (!location) {
      throw new ApiError('NOT_FOUND')
    }

    // 如果指定了imageIndex，更新对应的图片记录
    if (imageIndex !== null) {
      const targetImageIndex = parseInt(imageIndex)
      const existingImage = location.images?.find((img) => img.imageIndex === targetImageIndex)

      if (existingImage) {
        const updated = await db.locationImage.update({
          where: { id: existingImage.id },
          data: { imageUrl: key }
        })
        if (!location.selectedImageId) {
          await prisma.novelPromotionLocation.update({
            where: { id },
            data: { selectedImageId: updated.id }
          })
        }
      } else {
        const created = await db.locationImage.create({
          data: {
            locationId: id,
            imageIndex: targetImageIndex,
            imageUrl: key,
            description: labelText,
            isSelected: targetImageIndex === 0
          }
        })
        if (!location.selectedImageId) {
          await prisma.novelPromotionLocation.update({
            where: { id },
            data: { selectedImageId: created.id }
          })
        }
      }

      return NextResponse.json({
        success: true,
        imageKey: key,
        imageIndex: targetImageIndex
      })
    } else {
      // 创建新的图片记录
      const maxIndex = location.images?.length || 0
      const created = await db.locationImage.create({
        data: {
          locationId: id,
          imageIndex: maxIndex,
          imageUrl: key,
          description: labelText,
          isSelected: maxIndex === 0
        }
      })
      if (!location.selectedImageId) {
        await prisma.novelPromotionLocation.update({
          where: { id },
          data: { selectedImageId: created.id }
        })
      }

      return NextResponse.json({
        success: true,
        imageKey: key,
        imageIndex: maxIndex
      })
    }
  }

  throw new ApiError('INVALID_PARAMS')
})
