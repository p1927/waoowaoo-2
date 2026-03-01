import { logInfo as _ulogInfo, logWarn as _ulogWarn } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { deleteCOSObject } from '@/lib/cos'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST - Confirm selection and delete unselected candidates
 * Body: { characterId, appearanceId }
 * 
 * 工作流程：
 * 1. Verify one image selected (selectedIndex not null)
 * 2. Delete unselected from imageUrls (COS + DB)
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
  const { characterId, appearanceId } = body

  if (!characterId || !appearanceId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Get appearance by UUID
  const appearance = await prisma.characterAppearance.findUnique({
    where: { id: appearanceId },
    include: { character: true }
  })

  if (!appearance) {
    throw new ApiError('NOT_FOUND')
  }

  // 检查是否已选择
  if (appearance.selectedIndex === null || appearance.selectedIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Parse image array
  const imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'characterAppearance.imageUrls')

  if (imageUrls.length <= 1) {
    // Already single image, no-op
    return NextResponse.json({
      success: true,
      message: '已确认选择',
      deletedCount: 0
    })
  }

  const selectedIndex = appearance.selectedIndex
  const selectedImageUrl = imageUrls[selectedIndex]

  if (!selectedImageUrl) {
    throw new ApiError('NOT_FOUND')
  }

  // Delete unselected images
  const deletedImages: string[] = []
  for (let i = 0; i < imageUrls.length; i++) {
    if (i !== selectedIndex && imageUrls[i]) {
      const key = await resolveStorageKeyFromMediaValue(imageUrls[i]!)
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

  // Same for descriptions, keep only selected
  let descriptions: string[] = []
  if (appearance.descriptions) {
    try {
      descriptions = JSON.parse(appearance.descriptions)
    } catch { }
  }
  const selectedDescription = descriptions[selectedIndex] || appearance.description || ''

  // 更新数据库：Keep only selected images
  await prisma.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      imageUrl: selectedImageUrl,
      imageUrls: encodeImageUrls([selectedImageUrl]),  // Keep only selected images
      selectedIndex: 0,  // 现在只有一张，索引为0
      description: selectedDescription,
      descriptions: JSON.stringify([selectedDescription])
    }
  })

  _ulogInfo(`✓ 确认选择: ${appearance.character.name} - ${appearance.changeReason}`)
  _ulogInfo(`✓ 删除了 ${deletedImages.length} 张未选中的图片`)

  return NextResponse.json({
    success: true,
    message: 'Selection confirmed, other candidates deleted',
    deletedCount: deletedImages.length
  })
})
