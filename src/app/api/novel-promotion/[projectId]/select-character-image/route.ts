import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST - Select character appearance image
 * Update CharacterAppearance table directly
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { characterId, appearanceId, selectedIndex } = await request.json()

  if (!characterId || !appearanceId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Query by UUID
  const appearance = await prisma.characterAppearance.findUnique({
    where: { id: appearanceId },
    include: { character: true }
  })

  if (!appearance) {
    throw new ApiError('NOT_FOUND')
  }

  // Parse image URLs
  const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')

  // Validate index
  if (selectedIndex !== null) {
    if (selectedIndex < 0 || selectedIndex >= imageUrls.length || !imageUrls[selectedIndex]) {
      throw new ApiError('INVALID_PARAMS')
    }
  }

  const selectedImageKey = selectedIndex !== null ? imageUrls[selectedIndex] : null

  // Update record directly (no concurrency risk)
  await prisma.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      selectedIndex: selectedIndex,
      imageUrl: selectedImageKey
    }
  })

  if (selectedIndex !== null) {
    _ulogInfo(`✓ Character ${appearance.character.name} appearance ${appearanceId}: selected index ${selectedIndex}`)
  } else {
    _ulogInfo(`✓ Character ${appearance.character.name} appearance ${appearanceId}: selection cleared`)
  }

  const signedUrl = selectedImageKey ? getSignedUrl(selectedImageKey, 7 * 24 * 3600) : null

  return NextResponse.json({
    success: true,
    selectedIndex,
    imageUrl: signedUrl
  })
})
