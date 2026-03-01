import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadToCOS, getSignedUrl, toFetchableUrl, generateUniqueKey } from '@/lib/cos'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import sharp from 'sharp'
import { initializeFonts, createLabelSVG } from '@/lib/fonts'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST /api/novel-promotion/[projectId]/update-asset-label
 * Update black-bar label on asset images (call after name change)
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Initialize fonts (required in Vercel env)
  await initializeFonts()

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { type, id, newName, appearanceIndex } = body
  // type: 'character' | 'location'
  // id: characterId or locationId
  // newName: new name
  // appearanceIndex: character appearance index (character only)

  if (!type || !id || !newName) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (type === 'character') {
    // Fetch all character appearances
    const character = await prisma.novelPromotionCharacter.findUnique({
      where: { id: id },
      include: { appearances: true }
    })

    if (!character) {
      throw new ApiError('NOT_FOUND')
    }

    // Update each appearance's image label
    const updatePromises = character.appearances.map(async (appearance) => {
      // If appearanceIndex specified, only update that appearance
      if (appearanceIndex !== undefined && appearance.appearanceIndex !== appearanceIndex) {
        return null
      }

      // Fetch image URLs
      let imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
      if (imageUrls.length === 0 && appearance.imageUrl) {
        imageUrls = [appearance.imageUrl]
      }

      if (imageUrls.length === 0) return null

      // Update each image label
      const newLabelText = `${newName} - ${appearance.changeReason}`
      const newImageUrls: string[] = await Promise.all(
        imageUrls.map(async (url, i) => {
          if (!url) return ''
          try {
            return await updateImageLabel(url, newLabelText)
          } catch (e) {
            _ulogError(`Failed to update label for image ${i}:`, e)
            return url // Keep original URL
          }
        })
      )

      const firstUrl = newImageUrls.find((u) => !!u) || null

      // Update database
      await prisma.characterAppearance.update({
        where: { id: appearance.id },
        data: {
          imageUrls: encodeImageUrls(newImageUrls),
          imageUrl: firstUrl
        }
      })

      return { appearanceIndex: appearance.appearanceIndex, imageUrls: newImageUrls }
    })

    const results = await Promise.all(updatePromises)
    return NextResponse.json({ success: true, results: results.filter(r => r !== null) })

  } else if (type === 'location') {
    // Fetch location
    const location = await prisma.novelPromotionLocation.findUnique({
      where: { id: id },
      include: { images: true }
    })

    if (!location) {
      throw new ApiError('NOT_FOUND')
    }

    // Update each image label
    const updatePromises = location.images.map(async (image) => {
      if (!image.imageUrl) return null

      const newLabelText = newName
      try {
        const newImageUrl = await updateImageLabel(
          image.imageUrl,
          newLabelText
        )

        // Update database
        await prisma.locationImage.update({
          where: { id: image.id },
          data: { imageUrl: newImageUrl }
        })

        return { imageIndex: image.imageIndex, imageUrl: newImageUrl }
      } catch (e) {
        _ulogError(`Failed to update label for location image ${image.imageIndex}:`, e)
        return null
      }
    })

    const results = await Promise.all(updatePromises)
    return NextResponse.json({ success: true, results: results.filter(r => r !== null) })
  }

  throw new ApiError('INVALID_PARAMS')
})

/**
 * Update image black-bar label
 * Generate new COS key on upload so URL changes, browser cache invalidates, frontend sees new label
 */
async function updateImageLabel(imageUrl: string, newLabelText: string): Promise<string> {
  const originalKey = await resolveStorageKeyFromMediaValue(imageUrl)
  if (!originalKey) {
    throw new Error(`Failed to normalize media key: ${imageUrl}`)
  }
  const signedUrl = getSignedUrl(originalKey, 3600)

  // Download image
  const response = await fetch(toFetchableUrl(signedUrl))
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())

  // Get image metadata
  const meta = await sharp(buffer).metadata()
  const w = meta.width || 2160
  const h = meta.height || 2160

  // 计算标签条高度（与生成时一致：高度的 4%）
  const fontSize = Math.floor(h * 0.04)
  const pad = Math.floor(fontSize * 0.5)
  const barH = fontSize + pad * 2

  // 裁剪掉顶部的旧标签条
  const croppedBuffer = await sharp(buffer)
    .extract({ left: 0, top: barH, width: w, height: h - barH })
    .toBuffer()

  // Create new SVG label bar
  const svg = await createLabelSVG(w, barH, fontSize, pad, newLabelText)

  // 添加新标签条到图片顶部
  const processed = await sharp(croppedBuffer)
    .extend({ top: barH, bottom: 0, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer()

  // 🔥 生成新 key 上传，使图片 URL 发生变化，强制浏览器绕过缓存，确保前端能看到新标签
  const newKey = generateUniqueKey('labeled-rename', 'jpg')
  await uploadToCOS(processed, newKey)
  return newKey
}
