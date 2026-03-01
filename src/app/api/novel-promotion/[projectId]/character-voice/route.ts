import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { uploadToCOS, generateUniqueKey, getSignedUrl } from '@/lib/cos'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * PATCH /api/novel-promotion/[projectId]/character-voice
 * Update character voice settings
 * Body: { characterId, voiceType, voiceId, customVoiceUrl }
 */
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { characterId, voiceType, voiceId, customVoiceUrl } = body

  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Update character voice settings
  const character = await prisma.novelPromotionCharacter.update({
    where: { id: characterId },
    data: {
      voiceType: voiceType || null,
      voiceId: voiceId || null,
      customVoiceUrl: customVoiceUrl || null
    }
  })

  return NextResponse.json({ success: true, character })
})

/**
 * POST /api/novel-promotion/[projectId]/character-voice
 * Upload custom voice or save AI-designed voice
 * FormData: { characterId, file } - file upload
 * JSON: { characterId, voiceDesign } - AI voice design
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const contentType = request.headers.get('content-type') || ''

  // Handle JSON request (AI voice design)
  if (contentType.includes('application/json')) {
    const body = await request.json()
    const { characterId, voiceDesign } = body

    if (!characterId || !voiceDesign) {
      throw new ApiError('INVALID_PARAMS')
    }

    const { voiceId, audioBase64 } = voiceDesign
    if (!voiceId || !audioBase64) {
      throw new ApiError('INVALID_PARAMS')
    }

    // Decode base64 audio
    const audioBuffer = Buffer.from(audioBase64, 'base64')

    // Upload to COS
    const key = generateUniqueKey(`voice/custom/${projectId}/${characterId}`, 'wav')
    const cosUrl = await uploadToCOS(audioBuffer, key)

    // Update character voice settings
    const character = await prisma.novelPromotionCharacter.update({
      where: { id: characterId },
      data: {
        voiceType: 'custom',
        voiceId: voiceId,  // Store AI-generated voice ID
        customVoiceUrl: cosUrl
      }
    })

    _ulogInfo(`Character ${characterId} AI-designed voice saved: ${cosUrl}, voiceId: ${voiceId}`)

    // Return signed URL
    const signedAudioUrl = getSignedUrl(cosUrl, 7200)

    return NextResponse.json({
      success: true,
      audioUrl: signedAudioUrl,
      character: {
        ...character,
        customVoiceUrl: signedAudioUrl
      }
    })
  }

  // Handle FormData (file upload)
  const formData = await request.formData()
  const file = formData.get('file') as File
  const characterId = formData.get('characterId') as string

  if (!file || !characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Validate file type
  const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/m4a', 'audio/x-m4a']
  if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp3|wav|ogg|m4a)$/i)) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Read file
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // Get file extension
  const ext = file.name.split('.').pop()?.toLowerCase() || 'mp3'

  // Upload to COS
  const key = generateUniqueKey(`voice/custom/${projectId}/${characterId}`, ext)
  const audioUrl = await uploadToCOS(buffer, key)

  // Set character voice to custom
  const character = await prisma.novelPromotionCharacter.update({
    where: { id: characterId },
    data: {
      voiceType: 'custom',
      voiceId: characterId, // Use characterId as id
      customVoiceUrl: audioUrl
    }
  })

  _ulogInfo(`Character ${characterId} voice uploaded: ${audioUrl}`)

  // Return signed URL for immediate playback
  const signedAudioUrl = getSignedUrl(audioUrl, 7200)

  return NextResponse.json({
    success: true,
    audioUrl: signedAudioUrl,
    character: {
      ...character,
      customVoiceUrl: signedAudioUrl // Return signed URL to frontend
    }
  })
})
