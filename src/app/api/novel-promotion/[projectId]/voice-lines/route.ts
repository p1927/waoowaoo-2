import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveMediaRef, resolveMediaRefFromLegacyValue } from '@/lib/media/service'

async function resolveMatchedPanelData(
  matchedPanelId: string | null | undefined,
  expectedEpisodeId?: string
) {
  if (matchedPanelId === undefined) {
    return null
  }

  if (matchedPanelId === null) {
    return {
      matchedPanelId: null,
      matchedStoryboardId: null,
      matchedPanelIndex: null
    }
  }

  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: matchedPanelId },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      storyboard: {
        select: {
          episodeId: true
        }
      }
    }
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }
  if (expectedEpisodeId && panel.storyboard.episodeId !== expectedEpisodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  return {
    matchedPanelId: panel.id,
    matchedStoryboardId: panel.storyboardId,
    matchedPanelIndex: panel.panelIndex
  }
}

async function withVoiceLineMedia<T extends Record<string, unknown>>(line: T) {
  const audioMedia = await resolveMediaRef(line.audioMediaId, line.audioUrl)
  const matchedPanel = line.matchedPanel as
    | {
      storyboardId?: string | null
      panelIndex?: number | null
    }
    | null
    | undefined
  return {
    ...line,
    media: audioMedia,
    audioMedia,
    audioUrl: audioMedia?.url || line.audioUrl || null,
    matchedStoryboardId: matchedPanel?.storyboardId ?? line.matchedStoryboardId,
    matchedPanelIndex: matchedPanel?.panelIndex ?? line.matchedPanelIndex}
}

/**
 * GET /api/novel-promotion/[projectId]/voice-lines?episodeId=xxx
 * Get episode voice lines list
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const episodeId = searchParams.get('episodeId')
  const speakersOnly = searchParams.get('speakersOnly')

  if (speakersOnly === '1') {
    const novelProject = await prisma.novelPromotionProject.findUnique({
      where: { projectId },
      select: { id: true }
    })
    if (!novelProject) {
      throw new ApiError('NOT_FOUND')
    }

    const speakerRows = await prisma.novelPromotionVoiceLine.findMany({
      where: {
        episode: {
          novelPromotionProjectId: novelProject.id
        }
      },
      select: { speaker: true },
      distinct: ['speaker'],
      orderBy: { speaker: 'asc' }
    })

    return NextResponse.json({
      speakers: speakerRows.map(item => item.speaker).filter(Boolean)
    })
  }

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Fetch voice lines (with matched Panel info)
  const voiceLines = await prisma.novelPromotionVoiceLine.findMany({
    where: { episodeId },
    orderBy: { lineIndex: 'asc' },
    include: {
      matchedPanel: {
        select: {
          id: true,
          storyboardId: true,
          panelIndex: true
        }
      }
    }
  })

  // Convert to stable media URLs and add compatible fields
  const voiceLinesWithUrls = await Promise.all(voiceLines.map(withVoiceLineMedia))

  // Count speakers
  const speakerStats: Record<string, number> = {}
  for (const line of voiceLines) {
    speakerStats[line.speaker] = (speakerStats[line.speaker] || 0) + 1
  }

  return NextResponse.json({
    voiceLines: voiceLinesWithUrls,
    count: voiceLines.length,
    speakerStats
  })
})

/**
 * POST /api/novel-promotion/[projectId]/voice-lines
 * Add single voice line
 * Body: { episodeId, content, speaker, matchedPanelId?: string | null }
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
  const { episodeId, content, speaker, matchedPanelId } = body

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!content || !content.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!speaker || !speaker.trim()) {
    throw new ApiError('INVALID_PARAMS')
  }

  const novelPromotionProject = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true }
  })
  if (!novelPromotionProject) {
    throw new ApiError('NOT_FOUND')
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: {
      id: episodeId,
      novelPromotionProjectId: novelPromotionProject.id
    },
    select: { id: true }
  })
  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  const maxLine = await prisma.novelPromotionVoiceLine.findFirst({
    where: { episodeId },
    orderBy: { lineIndex: 'desc' },
    select: { lineIndex: true }
  })
  const nextLineIndex = (maxLine?.lineIndex || 0) + 1

  const matchedPanelData = await resolveMatchedPanelData(
    matchedPanelId === undefined ? undefined : matchedPanelId,
    episodeId
  )

  const created = await prisma.novelPromotionVoiceLine.create({
    data: {
      episodeId,
      lineIndex: nextLineIndex,
      content: content.trim(),
      speaker: speaker.trim(),
      ...(matchedPanelData || {})
    },
    include: {
      matchedPanel: {
        select: {
          id: true,
          storyboardId: true,
          panelIndex: true
        }
      }
    }
  })

  const voiceLine = await withVoiceLineMedia(created)

  return NextResponse.json({
    success: true,
    voiceLine
  })
})

/**
 * PATCH /api/novel-promotion/[projectId]/voice-lines
 * Update voice line settings (content, speaker, emotion, audio URL)
 * Body: { lineId, content, speaker, emotionPrompt, emotionStrength, audioUrl }
 *    or { speaker, episodeId, voicePresetId } (batch update same speaker's voice)
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
  const {
    lineId,
    speaker,
    episodeId,
    voicePresetId,
    emotionPrompt,
    emotionStrength,
    content,
    audioUrl,
    matchedPanelId
  } = body

  // Single line update
  if (lineId) {
    const updateData: Prisma.NovelPromotionVoiceLineUncheckedUpdateInput = {}
    if (voicePresetId !== undefined) updateData.voicePresetId = voicePresetId
    if (emotionPrompt !== undefined) updateData.emotionPrompt = emotionPrompt || null
    if (emotionStrength !== undefined) updateData.emotionStrength = emotionStrength
    if (content !== undefined) {
      if (!content.trim()) {
        throw new ApiError('INVALID_PARAMS')
      }
      updateData.content = content.trim()
    }
    if (speaker !== undefined) {
      if (!speaker.trim()) {
        throw new ApiError('INVALID_PARAMS')
      }
      updateData.speaker = speaker.trim()
    }
    if (audioUrl !== undefined) {
      updateData.audioUrl = audioUrl // Support clearing audio (pass null)
      const media = await resolveMediaRefFromLegacyValue(audioUrl)
      updateData.audioMediaId = media?.id || null
    }
    if (matchedPanelId !== undefined) {
      const currentLine = await prisma.novelPromotionVoiceLine.findUnique({
        where: { id: lineId },
        select: { episodeId: true }
      })
      if (!currentLine) {
        throw new ApiError('NOT_FOUND')
      }

      const matchedPanelData = await resolveMatchedPanelData(matchedPanelId, currentLine.episodeId)
      if (matchedPanelData) {
        updateData.matchedPanelId = matchedPanelData.matchedPanelId
        updateData.matchedStoryboardId = matchedPanelData.matchedStoryboardId
        updateData.matchedPanelIndex = matchedPanelData.matchedPanelIndex
      }
    }

    const updated = await prisma.novelPromotionVoiceLine.update({
      where: { id: lineId },
      data: updateData,
      include: {
        matchedPanel: {
          select: {
            id: true,
            storyboardId: true,
            panelIndex: true
          }
        }
      }
    })
    return NextResponse.json({
      success: true,
      voiceLine: await withVoiceLineMedia(updated)
    })
  }

  // Batch update same speaker (voice only)
  if (speaker && episodeId) {
    const result = await prisma.novelPromotionVoiceLine.updateMany({
      where: {
        episodeId,
        speaker
      },
      data: { voicePresetId }
    })
    return NextResponse.json({
      success: true,
      updatedCount: result.count,
      speaker,
      voicePresetId
    })
  }

  throw new ApiError('INVALID_PARAMS')
})

/**
 * DELETE /api/novel-promotion/[projectId]/voice-lines?lineId=xxx
 * Delete single voice line
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
  const lineId = searchParams.get('lineId')

  if (!lineId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Fetch line to delete
  const lineToDelete = await prisma.novelPromotionVoiceLine.findUnique({
    where: { id: lineId }
  })

  if (!lineToDelete) {
    throw new ApiError('NOT_FOUND')
  }

  // Delete voice line
  await prisma.novelPromotionVoiceLine.delete({
    where: { id: lineId }
  })

  // Reorder remaining lines' lineIndex
  const remainingLines = await prisma.novelPromotionVoiceLine.findMany({
    where: { episodeId: lineToDelete.episodeId },
    orderBy: { lineIndex: 'asc' }
  })

  // Update each line's lineIndex
  for (let i = 0; i < remainingLines.length; i++) {
    if (remainingLines[i].lineIndex !== i + 1) {
      await prisma.novelPromotionVoiceLine.update({
        where: { id: remainingLines[i].id },
        data: { lineIndex: i + 1 }
      })
    }
  }

  return NextResponse.json({
    success: true,
    deletedId: lineId,
    remainingCount: remainingLines.length
  })
})
