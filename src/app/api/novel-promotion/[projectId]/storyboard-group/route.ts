import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * POST /api/novel-promotion/[projectId]/storyboard-group
 * Add a new storyboard group (create Clip + Storyboard + initial Panel)
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { episodeId, insertIndex } = body

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Fetch episode and existing clips
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: { orderBy: { createdAt: 'asc' } }
    }
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const existingClips = episode.clips
  const insertAt = insertIndex !== undefined ? insertIndex : existingClips.length

  // Compute new clip createdAt for ordering
  let newCreatedAt: Date

  if (existingClips.length === 0) {
    // No existing clips, use current time
    newCreatedAt = new Date()
  } else if (insertAt === 0) {
    // Insert at start, set time before first clip
    const firstClip = existingClips[0]
    newCreatedAt = new Date(firstClip.createdAt.getTime() - 1000) // minus 1 second
  } else if (insertAt >= existingClips.length) {
    // Insert at end, set time after last clip
    const lastClip = existingClips[existingClips.length - 1]
    newCreatedAt = new Date(lastClip.createdAt.getTime() + 1000) // plus 1 second
  } else {
    // Insert in middle, set time between prev and next clip
    const prevClip = existingClips[insertAt - 1]
    const nextClip = existingClips[insertAt]
    const midTime = (prevClip.createdAt.getTime() + nextClip.createdAt.getTime()) / 2
    newCreatedAt = new Date(midTime)
  }

  // Use transaction to create Clip + Storyboard + Panel
  const result = await prisma.$transaction(async (tx) => {
    // 1. Create new Clip (manually added type)
    const newClip = await tx.novelPromotionClip.create({
      data: {
        episodeId,
        summary: 'Manually added storyboard group',
        content: '',
        location: null,
        characters: null,
        createdAt: newCreatedAt
      }
    })

    // 2. Create associated Storyboard
    const newStoryboard = await tx.novelPromotionStoryboard.create({
      data: {
        episodeId,
        clipId: newClip.id,
        panelCount: 1
      }
    })

    // 3. Create initial Panel
    const newPanel = await tx.novelPromotionPanel.create({
      data: {
        storyboardId: newStoryboard.id,
        panelIndex: 0,
        panelNumber: 1,
        shotType: 'Medium shot',
        cameraMove: 'Fixed',
        description: 'New shot description',
        characters: '[]'
      }
    })

    return { clip: newClip, storyboard: newStoryboard, panel: newPanel }
  })

  _ulogInfo(`[Add storyboard group] episodeId=${episodeId}, clipId=${result.clip.id}, storyboardId=${result.storyboard.id}, insertAt=${insertAt}`)

  return NextResponse.json({
    success: true,
    clip: result.clip,
    storyboard: result.storyboard,
    panel: result.panel
  })
})

/**
 * PUT /api/novel-promotion/[projectId]/storyboard-group
 * Reorder storyboard groups (by modifying clip createdAt)
 */
export const PUT = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { episodeId, clipId, direction } = body // direction: 'up' | 'down'

  if (!episodeId || !clipId || !direction) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Fetch episode and all clips (ordered by createdAt)
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: { orderBy: { createdAt: 'asc' } }
    }
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const clips = episode.clips
  const currentIndex = clips.findIndex(c => c.id === clipId)

  if (currentIndex === -1) {
    throw new ApiError('NOT_FOUND')
  }

  // Compute target position
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1

  // Check bounds
  if (targetIndex < 0 || targetIndex >= clips.length) {
    throw new ApiError('INVALID_PARAMS')
  }

  const currentClip = clips[currentIndex]
  const targetClip = clips[targetIndex]

  // Swap createdAt of the two clips (small time delta to avoid conflict)
  const tempTime = currentClip.createdAt.getTime()
  const targetTime = targetClip.createdAt.getTime()

  // Use transaction to update
  await prisma.$transaction(async (tx) => {
    // First move current clip to temporary time
    await tx.novelPromotionClip.update({
      where: { id: currentClip.id },
      data: { createdAt: new Date(0) } // Temporary time
    })

    // Update target clip time
    await tx.novelPromotionClip.update({
      where: { id: targetClip.id },
      data: { createdAt: new Date(tempTime) }
    })

    // Update current clip to target time
    await tx.novelPromotionClip.update({
      where: { id: currentClip.id },
      data: { createdAt: new Date(targetTime) }
    })
  })

  _ulogInfo(`[Move storyboard group] clipId=${clipId}, direction=${direction}, ${currentIndex} -> ${targetIndex}`)

  return NextResponse.json({ success: true })
})

/**
 * DELETE /api/novel-promotion/[projectId]/storyboard-group
 * Delete entire storyboard group (Clip + Storyboard + all Panels)
 */
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const storyboardId = searchParams.get('storyboardId')

  if (!storyboardId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Fetch storyboard and associated clip
  const storyboard = await prisma.novelPromotionStoryboard.findUnique({
    where: { id: storyboardId },
    include: {
      panels: true,
      clip: true
    }
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND')
  }

  // Use transaction to delete (Prisma cascade handles related deletes, but we delete explicitly for consistency)
  await prisma.$transaction(async (tx) => {
    // 1. Delete all associated Panels
    await tx.novelPromotionPanel.deleteMany({
      where: { storyboardId }
    })

    // 2. Delete Storyboard
    await tx.novelPromotionStoryboard.delete({
      where: { id: storyboardId }
    })

    // 3. Delete associated Clip (if exists)
    if (storyboard.clipId) {
      await tx.novelPromotionClip.delete({
        where: { id: storyboard.clipId }
      })
    }
  })

  _ulogInfo(`[Delete storyboard group] storyboardId=${storyboardId}, clipId=${storyboard.clipId}, panelCount=${storyboard.panels.length}`)

  return NextResponse.json({ success: true })
})
