import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { serializeStructuredJsonField } from '@/lib/novel-promotion/panel-ai-data-sync'

function parseNullableNumberField(value: unknown): number | null {
  if (value === null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new ApiError('INVALID_PARAMS')
}

function toStructuredJsonField(value: unknown, fieldName: string): string | null {
  try {
    return serializeStructuredJsonField(value, fieldName)
  } catch (error) {
    const message = error instanceof Error ? error.message : `${fieldName} must be valid JSON`
    throw new ApiError('INVALID_PARAMS', { message })
  }
}

/**
 * POST /api/novel-promotion/[projectId]/panel
 * Create a new Panel
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
  const {
    storyboardId,
    shotType,
    cameraMove,
    description,
    location,
    characters,
    srtStart,
    srtEnd,
    duration,
    videoPrompt,
    firstLastFramePrompt,
  } = body

  if (!storyboardId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Verify storyboard exists and fetch existing panels to compute correct panelIndex
  const storyboard = await prisma.novelPromotionStoryboard.findUnique({
    where: { id: storyboardId },
    include: {
      panels: {
        orderBy: { panelIndex: 'desc' },
        take: 1
      }
    }
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND')
  }

  // Auto-compute correct panelIndex (max + 1, avoid unique constraint conflict)
  const maxPanelIndex = storyboard.panels.length > 0 ? storyboard.panels[0].panelIndex : -1
  const newPanelIndex = maxPanelIndex + 1
  const newPanelNumber = newPanelIndex + 1

  // Create new Panel record
  const newPanel = await prisma.novelPromotionPanel.create({
    data: {
      storyboardId,
      panelIndex: newPanelIndex,
      panelNumber: newPanelNumber,
      shotType: shotType ?? null,
      cameraMove: cameraMove ?? null,
      description: description ?? null,
      location: location ?? null,
      characters: characters ?? null,
      srtStart: srtStart ?? null,
      srtEnd: srtEnd ?? null,
      duration: duration ?? null,
      videoPrompt: videoPrompt ?? null,
      firstLastFramePrompt: firstLastFramePrompt ?? null,
    }
  })

  // Update panelCount
  const panelCount = await prisma.novelPromotionPanel.count({
    where: { storyboardId }
  })

  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: { panelCount }
  })

  return NextResponse.json({ success: true, panel: newPanel })
})

/**
 * DELETE /api/novel-promotion/[projectId]/panel
 * Delete a Panel
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
  const panelId = searchParams.get('panelId')

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Fetch Panel to delete
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId }
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  const storyboardId = panel.storyboardId

  // Use transaction to ensure atomic delete and reorder
  // Use batch updates to avoid performance issues from loops
  await prisma.$transaction(async (tx) => {
    // 1. Delete Panel
    await tx.novelPromotionPanel.delete({
      where: { id: panelId }
    })

    // 2. Batch reorder all panels
    // Get deleted panel's original index to determine update range
    const deletedPanelIndex = panel.panelIndex

    // Use Prisma batch update with two-phase offset to avoid unique constraint conflict
    const maxPanel = await tx.novelPromotionPanel.findFirst({
      where: { storyboardId },
      orderBy: { panelIndex: 'desc' },
      select: { panelIndex: true }
    })
    const maxPanelIndex = maxPanel?.panelIndex ?? -1
    const offset = maxPanelIndex + 1000

    // Phase 1: Shift up to avoid conflict with original indices
    await tx.novelPromotionPanel.updateMany({
      where: {
        storyboardId,
        panelIndex: { gt: deletedPanelIndex }
      },
      data: {
        panelIndex: { increment: offset },
        panelNumber: { increment: offset }
      }
    })

    // Phase 2: Fall back to correct position (overall -offset -1)
    await tx.novelPromotionPanel.updateMany({
      where: {
        storyboardId,
        panelIndex: { gt: deletedPanelIndex + offset }
      },
      data: {
        panelIndex: { decrement: offset + 1 },
        panelNumber: { decrement: offset + 1 }
      }
    })

    // 3. Get updated panel count
    const panelCount = await tx.novelPromotionPanel.count({
      where: { storyboardId }
    })

    // 4. Update storyboard panelCount
    await tx.novelPromotionStoryboard.update({
      where: { id: storyboardId },
      data: { panelCount }
    })
  }, {
    maxWait: 15000, // Max wait for transaction start: 15 seconds
    timeout: 30000  // Transaction timeout: 30 seconds (for batch updates with many panels)
  })

  return NextResponse.json({ success: true })
})

/**
 * PATCH /api/novel-promotion/[projectId]/panel
 * Update a single Panel's properties (video prompt, etc.)
 * Supports two update modes:
 * 1. Direct update by panelId (recommended, e.g. for clearing errors)
 * 2. Update by storyboardId + panelIndex (legacy API compatibility)
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { panelId, storyboardId, panelIndex, videoPrompt, firstLastFramePrompt } = body

  // Mode 1: Direct update by panelId (preferred)
  if (panelId) {
    const panel = await prisma.novelPromotionPanel.findUnique({
      where: { id: panelId }
    })

    if (!panel) {
      throw new ApiError('NOT_FOUND')
    }

    // Build update data
    const updateData: {
      videoPrompt?: string | null
      firstLastFramePrompt?: string | null
    } = {}
    if (videoPrompt !== undefined) updateData.videoPrompt = videoPrompt
    if (firstLastFramePrompt !== undefined) updateData.firstLastFramePrompt = firstLastFramePrompt

    await prisma.novelPromotionPanel.update({
      where: { id: panelId },
      data: updateData
    })

    return NextResponse.json({ success: true })
  }

  // Mode 2: Update by storyboardId + panelIndex (legacy API)
  if (!storyboardId || panelIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Verify storyboard exists
  const storyboard = await prisma.novelPromotionStoryboard.findUnique({
    where: { id: storyboardId }
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND')
  }

  // 构建更新数据
  const updateData: {
    videoPrompt?: string | null
    firstLastFramePrompt?: string | null
  } = {}
  if (videoPrompt !== undefined) {
    updateData.videoPrompt = videoPrompt
  }
  if (firstLastFramePrompt !== undefined) {
    updateData.firstLastFramePrompt = firstLastFramePrompt
  }

  // Attempt to update Panel
  const updatedPanel = await prisma.novelPromotionPanel.updateMany({
    where: {
      storyboardId,
      panelIndex
    },
    data: updateData
  })

  // If Panel does not exist, create it (Panel table is single source of truth)
  if (updatedPanel.count === 0) {
    // Create new Panel record
    await prisma.novelPromotionPanel.create({
      data: {
        storyboardId,
        panelIndex,
        panelNumber: panelIndex + 1,
        imageUrl: null,
        videoPrompt: videoPrompt ?? null,
        firstLastFramePrompt: firstLastFramePrompt ?? null,
      }
    })
  }

  return NextResponse.json({ success: true })
})

/**
 * PUT /api/novel-promotion/[projectId]/panel
 * Full update of all Panel properties (for storyboard text editing)
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
  const {
    storyboardId,
    panelIndex,
    panelNumber,
    shotType,
    cameraMove,
    description,
    location,
    characters,
    srtStart,
    srtEnd,
    duration,
    videoPrompt,
    firstLastFramePrompt,
    actingNotes,  // Acting direction data
    photographyRules,  // Single-shot photography rules
  } = body

  if (!storyboardId || panelIndex === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Verify storyboard exists
  const storyboard = await prisma.novelPromotionStoryboard.findUnique({
    where: { id: storyboardId }
  })

  if (!storyboard) {
    throw new ApiError('NOT_FOUND')
  }

  // Build update data - include all editable fields
  const updateData: {
    panelNumber?: number | null
    shotType?: string | null
    cameraMove?: string | null
    description?: string | null
    location?: string | null
    characters?: string | null
    srtStart?: number | null
    srtEnd?: number | null
    duration?: number | null
    videoPrompt?: string | null
    firstLastFramePrompt?: string | null
    actingNotes?: string | null
    photographyRules?: string | null
  } = {}
  if (panelNumber !== undefined) updateData.panelNumber = panelNumber
  if (shotType !== undefined) updateData.shotType = shotType
  if (cameraMove !== undefined) updateData.cameraMove = cameraMove
  if (description !== undefined) updateData.description = description
  if (location !== undefined) updateData.location = location
  if (characters !== undefined) updateData.characters = characters
  if (srtStart !== undefined) updateData.srtStart = parseNullableNumberField(srtStart)
  if (srtEnd !== undefined) updateData.srtEnd = parseNullableNumberField(srtEnd)
  if (duration !== undefined) updateData.duration = parseNullableNumberField(duration)
  if (videoPrompt !== undefined) updateData.videoPrompt = videoPrompt
  if (firstLastFramePrompt !== undefined) updateData.firstLastFramePrompt = firstLastFramePrompt
  // Store JSON fields as normalized JSON strings
  if (actingNotes !== undefined) {
    updateData.actingNotes = toStructuredJsonField(actingNotes, 'actingNotes')
  }
  if (photographyRules !== undefined) {
    updateData.photographyRules = toStructuredJsonField(photographyRules, 'photographyRules')
  }

  // Find existing Panel
  const existingPanel = await prisma.novelPromotionPanel.findUnique({
    where: {
      storyboardId_panelIndex: {
        storyboardId,
        panelIndex
      }
    }
  })

  if (existingPanel) {
    // Update existing Panel
    await prisma.novelPromotionPanel.update({
      where: { id: existingPanel.id },
      data: updateData
    })
  } else {
    // Create new Panel record
    await prisma.novelPromotionPanel.create({
      data: {
        storyboardId,
        panelIndex,
        panelNumber: panelNumber ?? panelIndex + 1,
        shotType: shotType ?? null,
        cameraMove: cameraMove ?? null,
        description: description ?? null,
        location: location ?? null,
        characters: characters ?? null,
        srtStart: srtStart ?? null,
        srtEnd: srtEnd ?? null,
        duration: duration ?? null,
        videoPrompt: videoPrompt ?? null,
        firstLastFramePrompt: firstLastFramePrompt ?? null,
        actingNotes: actingNotes !== undefined ? toStructuredJsonField(actingNotes, 'actingNotes') : null,
        photographyRules: photographyRules !== undefined ? toStructuredJsonField(photographyRules, 'photographyRules') : null,
      }
    })
  }

  // Panel table is single source of truth, no longer sync to storyboardTextJson
  // Only update panelCount for fast queries
  const panelCount = await prisma.novelPromotionPanel.count({
    where: { storyboardId }
  })

  await prisma.novelPromotionStoryboard.update({
    where: { id: storyboardId },
    data: { panelCount }
  })

  return NextResponse.json({ success: true })
})
