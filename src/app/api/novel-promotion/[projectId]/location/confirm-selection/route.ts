import { logInfo as _ulogInfo, logWarn as _ulogWarn } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteCOSObject } from '@/lib/cos'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST - Confirm location selection and delete unselected candidates
 * Body: { locationId }
 * 
 * Workflow:
 * 1. Verify one image is selected (isSelected)
 * 2. Delete other unselected images (COS + DB)
 * 3. Set selected as sole image
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { locationId } = body

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Get location and its images
  const location = await prisma.novelPromotionLocation.findUnique({
    where: { id: locationId },
    include: { images: { orderBy: { imageIndex: 'asc' } } }
  })

  if (!location) {
    throw new ApiError('NOT_FOUND')
  }

  const images = location.images || []

  if (images.length <= 1) {
    // Already single image, no-op
    return NextResponse.json({
      success: true,
      message: 'Selection confirmed',
      deletedCount: 0
    })
  }

  // Find selected image
  const selectedImage = location.selectedImageId
    ? images.find((img) => img.id === location.selectedImageId)
    : images.find((img) => img.isSelected)
  if (!selectedImage) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Delete unselected images
  const deletedImages: string[] = []
  const imagesToDelete = images.filter((img) => img.id !== selectedImage.id)

  for (const img of imagesToDelete) {
    if (img.imageUrl) {
      const key = await resolveStorageKeyFromMediaValue(img.imageUrl)
      if (key) {
        try {
          await deleteCOSObject(key)
          deletedImages.push(key)
        } catch {
          _ulogWarn('Failed to delete COS image:', key)
        }
      }
    }
  }

  // Update DB in transaction
  await prisma.$transaction(async (tx) => {
    // Delete unselected image records (exclude selected ID)
    await tx.locationImage.deleteMany({
      where: {
        locationId,
        id: { not: selectedImage.id }
      }
    })

    // Set selected image index to 0
    await tx.locationImage.update({
      where: { id: selectedImage.id },
      data: { imageIndex: 0 }
    })

    await tx.novelPromotionLocation.update({
      where: { id: locationId },
      data: { selectedImageId: selectedImage.id }
    })
  })

  _ulogInfo(`✓ 场景确认选择: ${location.name}`)
  _ulogInfo(`✓ Deleted ${deletedImages.length} unselected images`)

  return NextResponse.json({
    success: true,
    message: 'Selection confirmed, other candidates deleted',
    deletedCount: deletedImages.length
  })
})
