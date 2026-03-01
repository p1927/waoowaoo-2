import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteCOSObject } from '@/lib/cos'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

/**
 * POST - Cleanup unselected images
 * Called when user confirms assets for next step
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { novelData } = authResult

  let deletedCount = 0

  // 1. Cleanup unselected character appearance images
  const appearances = await prisma.characterAppearance.findMany({
    where: { character: { novelPromotionProjectId: novelData.id } },
    include: { character: true }
  })

  for (const appearance of appearances) {
    if (appearance.selectedIndex === null) continue

    try {
      const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')
      if (imageUrls.length <= 1) continue

      // Delete unselected images
      for (let i = 0; i < imageUrls.length; i++) {
        if (i !== appearance.selectedIndex && imageUrls[i]) {
          try {
            const key = await resolveStorageKeyFromMediaValue(imageUrls[i]!)
            if (key) {
              await deleteCOSObject(key)
              _ulogInfo(`✓ Deleted: ${key}`)
              deletedCount++
            }
          } catch { }
        }
      }

      // Keep only selected
      const selectedUrl = imageUrls[appearance.selectedIndex]
      if (!selectedUrl) continue
      await prisma.characterAppearance.update({
        where: { id: appearance.id },
        data: {
          imageUrls: encodeImageUrls([selectedUrl]),
          selectedIndex: 0
        }
      })
    } catch { }
  }

  // 2. Cleanup unselected location images
  const locations = await prisma.novelPromotionLocation.findMany({
    where: { novelPromotionProjectId: novelData.id },
    include: { images: true }
  })

  for (const location of locations) {
    const selectedImage = location.selectedImageId
      ? location.images.find(img => img.id === location.selectedImageId)
      : location.images.find(img => img.isSelected)
    if (!selectedImage) continue

    // Delete unselected images
    for (const img of location.images) {
      if (!img.isSelected && img.imageUrl) {
        try {
          const key = await resolveStorageKeyFromMediaValue(img.imageUrl)
          if (key) {
            await deleteCOSObject(key)
            _ulogInfo(`✓ Deleted: ${key}`)
            deletedCount++
          }
        } catch { }

        // Delete image records
        await prisma.locationImage.delete({ where: { id: img.id } })
      }
    }

    // Reset selected image index to 0
    await prisma.locationImage.update({
      where: { id: selectedImage.id },
      data: { imageIndex: 0 }
    })

    await prisma.novelPromotionLocation.update({
      where: { id: location.id },
      data: { selectedImageId: selectedImage.id }
    })
  }

  return NextResponse.json({ success: true, deletedCount })
})
