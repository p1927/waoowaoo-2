import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * GET - Get all episodes for project
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { novelData } = authResult

  const episodes = await prisma.novelPromotionEpisode.findMany({
    where: { novelPromotionProjectId: novelData.id },
    orderBy: { episodeNumber: 'asc' }
  })

  return NextResponse.json({ episodes })
})

/**
 * POST - Create new episode
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

  const body = await request.json()
  const { name, description } = body

  if (!name || name.trim().length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Get next episode number
  const lastEpisode = await prisma.novelPromotionEpisode.findFirst({
    where: { novelPromotionProjectId: novelData.id },
    orderBy: { episodeNumber: 'desc' }
  })
  const nextEpisodeNumber = (lastEpisode?.episodeNumber || 0) + 1

  // Create episode
  const episode = await prisma.novelPromotionEpisode.create({
    data: {
      novelPromotionProjectId: novelData.id,
      episodeNumber: nextEpisodeNumber,
      name: name.trim(),
      description: description?.trim() || null
    }
  })

  // Update last edited episode ID
  await prisma.novelPromotionProject.update({
    where: { id: novelData.id },
    data: { lastEpisodeId: episode.id }
  })

  return NextResponse.json({ episode }, { status: 201 })
})
