import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST - Select location image
 * Update LocationImage table directly
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { locationId, selectedIndex } = await request.json()

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Get location and all images
  const location = await prisma.novelPromotionLocation.findUnique({
    where: { id: locationId },
    include: { images: { orderBy: { imageIndex: 'asc' } } }
  })

  if (!location) {
    throw new ApiError('NOT_FOUND')
  }

  // Validate index
  if (selectedIndex !== null) {
    const targetImage = location.images.find(img => img.imageIndex === selectedIndex)
    if (!targetImage || !targetImage.imageUrl) {
      throw new ApiError('INVALID_PARAMS')
    }
  }

  // Clear all selected state (backward compat)
  await prisma.locationImage.updateMany({
    where: { locationId },
    data: { isSelected: false }
  })

  // Select given image
  let signedUrl: string | null = null
  if (selectedIndex !== null) {
    const updated = await prisma.locationImage.update({
      where: { locationId_imageIndex: { locationId, imageIndex: selectedIndex } },
      data: { isSelected: true }
    })
    signedUrl = updated.imageUrl ? getSignedUrl(updated.imageUrl, 7 * 24 * 3600) : null
    await prisma.novelPromotionLocation.update({
      where: { id: locationId },
      data: { selectedImageId: updated.id }
    })
    _ulogInfo(`✓ Location ${location.name}: selected index ${selectedIndex}`)
  } else {
    await prisma.novelPromotionLocation.update({
      where: { id: locationId },
      data: { selectedImageId: null }
    })
    _ulogInfo(`✓ Location ${location.name}: selection cleared`)
  }

  return NextResponse.json({
    success: true,
    selectedIndex,
    imageUrl: signedUrl
  })
})
