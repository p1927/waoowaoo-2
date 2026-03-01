import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'

interface SpeakerVoiceConfig {
  voiceType?: string
  voiceId?: string
  audioUrl: string
}

/**
 * GET /api/novel-promotion/[projectId]/speaker-voice?episodeId=xxx
 * Get episode speaker voice config
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const { searchParams } = new URL(request.url)
  const episodeId = searchParams.get('episodeId')

  // Auth check
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Get episode
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId }
  })

  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  // Parse speaker voice
  let speakerVoices: Record<string, SpeakerVoiceConfig> = {}
  if (episode.speakerVoices) {
    try {
      speakerVoices = JSON.parse(episode.speakerVoices)
      // Sign audio URL
      for (const speaker of Object.keys(speakerVoices)) {
        if (speakerVoices[speaker].audioUrl && !speakerVoices[speaker].audioUrl.startsWith('http')) {
          speakerVoices[speaker].audioUrl = getSignedUrl(speakerVoices[speaker].audioUrl, 7200)
        }
      }
    } catch {
      speakerVoices = {}
    }
  }

  return NextResponse.json({ speakerVoices })
})

/**
 * PATCH /api/novel-promotion/[projectId]/speaker-voice
 * Set speaker voice (write episode.speakerVoices JSON)
 * For characters not in asset hub, bind voice inline in dubbing
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => null)
  const episodeId = typeof body?.episodeId === 'string' ? body.episodeId : ''
  const speaker = typeof body?.speaker === 'string' ? body.speaker.trim() : ''
  const audioUrl = typeof body?.audioUrl === 'string' ? body.audioUrl.trim() : ''
  const voiceType = typeof body?.voiceType === 'string' ? body.voiceType : 'uploaded'
  const voiceId = typeof body?.voiceId === 'string' ? body.voiceId : undefined

  if (!episodeId) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!speaker) {
    throw new ApiError('INVALID_PARAMS')
  }
  if (!audioUrl) {
    throw new ApiError('INVALID_PARAMS')
  }

  const projectData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    select: { id: true }
  })
  if (!projectData) {
    throw new ApiError('NOT_FOUND')
  }

  const episode = await prisma.novelPromotionEpisode.findFirst({
    where: { id: episodeId, novelPromotionProjectId: projectData.id },
    select: { id: true, speakerVoices: true }
  })
  if (!episode) {
    throw new ApiError('NOT_FOUND')
  }

  // Parse existing speakerVoices, merge new entries
  let speakerVoices: Record<string, SpeakerVoiceConfig> = {}
  if (episode.speakerVoices) {
    try {
      speakerVoices = JSON.parse(episode.speakerVoices)
    } catch {
      speakerVoices = {}
    }
  }

  // Resolve frontend audioUrl to storageKey
  // Match asset hub customVoiceUrl format for worker
  const resolvedStorageKey = await resolveStorageKeyFromMediaValue(audioUrl)
  const audioUrlToStore = resolvedStorageKey || audioUrl

  speakerVoices[speaker] = {
    voiceType,
    ...(voiceId ? { voiceId } : {}),
    audioUrl: audioUrlToStore
  }

  await prisma.novelPromotionEpisode.update({
    where: { id: episodeId },
    data: { speakerVoices: JSON.stringify(speakerVoices) }
  })

  return NextResponse.json({ success: true })
})
