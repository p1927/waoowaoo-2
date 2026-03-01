import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { characterId, appearanceId, newDescription, descriptionIndex } = body

  if (!characterId || !appearanceId || !newDescription) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Query by UUID directly
  const appearance = await prisma.characterAppearance.findUnique({
    where: { id: appearanceId }
  })

  if (!appearance) {
    throw new ApiError('NOT_FOUND')
  }

  const trimmedDescription = newDescription.trim()

  // Parse descriptions JSON
  let descriptions: string[] = []
  if (appearance.descriptions) {
    try { descriptions = JSON.parse(appearance.descriptions) } catch { }
  }
  if (descriptions.length === 0) {
    descriptions = [appearance.description || '']
  }

  // Update description at specified index
  if (descriptionIndex !== undefined && descriptionIndex !== null) {
    descriptions[descriptionIndex] = trimmedDescription
  } else {
    descriptions[0] = trimmedDescription
  }

  // Update standalone table record directly
  await prisma.characterAppearance.update({
    where: { id: appearance.id },
    data: {
      descriptions: JSON.stringify(descriptions),
      description: descriptions[0]
    }
  })

  return NextResponse.json({ success: true })
})
