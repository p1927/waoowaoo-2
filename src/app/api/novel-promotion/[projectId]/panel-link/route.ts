import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

// POST - Update panel first/last frame link state
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { storyboardId, panelIndex, linked } = body

  if (!storyboardId || panelIndex === undefined || linked === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Update panel link state
  await prisma.novelPromotionPanel.update({
    where: {
      storyboardId_panelIndex: {
        storyboardId,
        panelIndex
      }
    },
    data: {
      linkedToNextPanel: linked
    }
  })

  return NextResponse.json({ success: true })
})
