import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// GET - Get user preference config
export const GET = apiHandler(async () => {
  // Auth verification
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Fetch or create user preference
  const preference = await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    update: {},
    create: { userId: session.user.id }
  })

  return NextResponse.json({ preference })
})

// PATCH - Update user preference config
export const PATCH = apiHandler(async (request: NextRequest) => {
  // Auth verification
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = await request.json()

  // Only allow updating specific fields
  const allowedFields = [
    'analysisModel',
    'characterModel',
    'locationModel',
    'storyboardModel',
    'editModel',
    'videoModel',
    'lipSyncModel',
    'videoRatio',
    'artStyle',
    'ttsRate'
  ]

  const updateData: Record<string, unknown> = {}
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field]
    }
  }

  if (Object.keys(updateData).length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Update or create user preference
  const preference = await prisma.userPreference.upsert({
    where: { userId: session.user.id },
    update: updateData,
    create: {
      userId: session.user.id,
      ...updateData
    }
  })

  return NextResponse.json({ preference })
})
