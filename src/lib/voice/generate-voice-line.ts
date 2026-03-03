import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { fal } from '@fal-ai/client'
import { prisma } from '@/lib/prisma'
import { getAudioApiKey, getProviderConfig, getProviderKey, resolveModelSelectionOrSingle } from '@/lib/api-config'
import { extractCOSKey, getSignedUrl, imageUrlToBase64, toFetchableUrl, uploadToCOS } from '@/lib/cos'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'

type CheckCancelled = () => Promise<void>

function getWavDurationFromBuffer(buffer: Buffer): number {
  try {
    const riff = buffer.slice(0, 4).toString('ascii')
    if (riff !== 'RIFF') {
      return Math.round((buffer.length * 8) / 128)
    }

    const byteRate = buffer.readUInt32LE(28)
    let offset = 12
    let dataSize = 0

    while (offset < buffer.length - 8) {
      const chunkId = buffer.slice(offset, offset + 4).toString('ascii')
      const chunkSize = buffer.readUInt32LE(offset + 4)

      if (chunkId === 'data') {
        dataSize = chunkSize
        break
      }

      offset += 8 + chunkSize
    }

    if (dataSize > 0 && byteRate > 0) {
      return Math.round((dataSize / byteRate) * 1000)
    }

    return Math.round((buffer.length * 8) / 128)
  } catch {
    return Math.round((buffer.length * 8) / 128)
  }
}

async function generateVoiceWithIndexTTS2(params: {
  endpoint: string
  referenceAudioUrl: string
  text: string
  emotionPrompt?: string | null
  strength?: number
  falApiKey?: string
}) {
  const strength = typeof params.strength === 'number' ? params.strength : 0.4

  _ulogInfo(`IndexTTS2: Generating with reference audio, strength: ${strength}`)
  if (params.emotionPrompt) {
    _ulogInfo(`IndexTTS2: Using emotion prompt: ${params.emotionPrompt}`)
  }

  if (params.falApiKey) {
    fal.config({ credentials: params.falApiKey })
  }

  const audioDataUrl = params.referenceAudioUrl.startsWith('data:')
    ? params.referenceAudioUrl
    : await imageUrlToBase64(params.referenceAudioUrl)

  const input: {
    audio_url: string
    prompt: string
    should_use_prompt_for_emotion: boolean
    strength: number
    emotion_prompt?: string
  } = {
    audio_url: audioDataUrl,
    prompt: params.text,
    should_use_prompt_for_emotion: true,
    strength,
  }

  if (params.emotionPrompt?.trim()) {
    input.emotion_prompt = params.emotionPrompt.trim()
  }

  const result = await fal.subscribe(params.endpoint, {
    input,
    logs: false,
  })

  const audioUrl = (result as { data?: { audio?: { url?: string } } })?.data?.audio?.url
  if (!audioUrl) {
    throw new Error('No audio URL in response')
  }

  const response = await fetch(toFetchableUrl(audioUrl))
  if (!response.ok) {
    throw new Error(`Audio download failed: ${response.status}`)
  }
  const arrayBuffer = await response.arrayBuffer()
  const audioData = Buffer.from(arrayBuffer)

  return {
    audioData,
    audioDuration: getWavDurationFromBuffer(audioData),
  }
}

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const GOOGLE_TTS_DEFAULT_VOICE = 'en-US-Neural2-F'

function extractGoogleLanguageCode(voiceName: string): string {
  const parts = voiceName.split('-')
  if (parts.length >= 2) return `${parts[0]}-${parts[1]}`
  return 'en-US'
}

const MP3_BITRATE_TABLE: Record<number, ReadonlyArray<number>> = {
  // MPEG1 Layer III bitrate index → kbps (index 0 = free, 15 = bad)
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0],
}

function getMp3DurationFromBuffer(buffer: Buffer): number {
  let totalBits = 0
  let totalFrames = 0
  let offset = 0

  // Skip ID3v2 tag if present
  if (buffer.length > 10 && buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
    const tagSize =
      ((buffer[6] & 0x7f) << 21) |
      ((buffer[7] & 0x7f) << 14) |
      ((buffer[8] & 0x7f) << 7) |
      (buffer[9] & 0x7f)
    offset = 10 + tagSize
  }

  // Sample first N frames to compute average bitrate
  const maxFramesToSample = 64
  while (offset < buffer.length - 4 && totalFrames < maxFramesToSample) {
    if (buffer[offset] !== 0xff || (buffer[offset + 1] & 0xe0) !== 0xe0) {
      offset++
      continue
    }
    const bitrateIndex = (buffer[offset + 2] >> 4) & 0x0f
    if (bitrateIndex === 0 || bitrateIndex === 15) {
      offset++
      continue
    }
    const bitrate = MP3_BITRATE_TABLE[3]?.[bitrateIndex]
    if (!bitrate) {
      offset++
      continue
    }
    totalBits += bitrate
    totalFrames++

    // Advance past this frame (MPEG1 Layer III: frameSize = 144 * bitrate * 1000 / sampleRate + padding)
    const paddingBit = (buffer[offset + 2] >> 1) & 0x01
    const sampleRateIndex = (buffer[offset + 2] >> 2) & 0x03
    const sampleRates = [44100, 48000, 32000]
    const sampleRate = sampleRates[sampleRateIndex] || 44100
    const frameSize = Math.floor((144 * bitrate * 1000) / sampleRate) + paddingBit
    offset += Math.max(frameSize, 1)
  }

  if (totalFrames === 0) {
    return Math.round((buffer.length * 8) / (32 * 1000) * 1000)
  }

  const avgBitrateKbps = totalBits / totalFrames
  const durationSec = (buffer.length * 8) / (avgBitrateKbps * 1000)
  return Math.round(durationSec * 1000)
}

const GOOGLE_TTS_MAX_RETRIES = 3

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500
}

async function generateVoiceWithGoogleTTS(params: {
  text: string
  voice?: string
  apiKey: string
}): Promise<{ audioData: Buffer; audioDuration: number }> {
  const voiceName = params.voice && params.voice !== 'default' ? params.voice : GOOGLE_TTS_DEFAULT_VOICE
  const languageCode = extractGoogleLanguageCode(voiceName)

  _ulogInfo(`Google TTS: Generating with voice=${voiceName}, lang=${languageCode}`)

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= GOOGLE_TTS_MAX_RETRIES; attempt++) {
    const response = await fetch(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(params.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text: params.text },
        voice: { languageCode, name: voiceName },
        audioConfig: { audioEncoding: 'MP3' },
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      lastError = new Error(`Google Cloud TTS failed (${response.status}): ${errorText}`)

      if (attempt < GOOGLE_TTS_MAX_RETRIES && isRetryableHttpStatus(response.status)) {
        const delayMs = 1000 * Math.pow(2, attempt - 1)
        _ulogInfo(`Google TTS: Attempt ${attempt}/${GOOGLE_TTS_MAX_RETRIES} failed (${response.status}), retrying in ${delayMs}ms`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
        continue
      }
      throw lastError
    }

    const data = (await response.json()) as { audioContent?: string }
    if (!data.audioContent) {
      throw new Error('Google Cloud TTS did not return audio content')
    }

    const audioData = Buffer.from(data.audioContent, 'base64')
    return {
      audioData,
      audioDuration: getMp3DurationFromBuffer(audioData),
    }
  }

  throw lastError ?? new Error('Google Cloud TTS failed after retries')
}

function matchCharacterBySpeaker(
  speaker: string,
  characters: Array<{ name: string; customVoiceUrl?: string | null; voiceId?: string | null }>
) {
  const exactMatch = characters.find((character) => character.name === speaker)
  if (exactMatch) return exactMatch
  return characters.find((character) => character.name.includes(speaker) || speaker.includes(character.name))
}

export async function generateVoiceLine(params: {
  projectId: string
  episodeId?: string | null
  lineId: string
  userId: string
  audioModel?: string
  checkCancelled?: CheckCancelled
}) {
  const checkCancelled = params.checkCancelled

  const line = await prisma.novelPromotionVoiceLine.findUnique({
    where: { id: params.lineId },
    select: {
      id: true,
      episodeId: true,
      speaker: true,
      content: true,
      emotionPrompt: true,
      emotionStrength: true,
    },
  })
  if (!line) {
    throw new Error('Voice line not found')
  }

  const episodeId = params.episodeId || line.episodeId
  if (!episodeId) {
    throw new Error('episodeId is required')
  }

  const [projectData, episode] = await Promise.all([
    prisma.novelPromotionProject.findUnique({
      where: { projectId: params.projectId },
      include: { characters: true },
    }),
    prisma.novelPromotionEpisode.findUnique({
      where: { id: episodeId },
      select: { speakerVoices: true },
    }),
  ])

  if (!projectData) {
    throw new Error('Novel promotion project not found')
  }

  let speakerVoices: Record<string, { audioUrl?: string | null; voiceId?: string | null; voiceType?: string | null }> = {}
  if (episode?.speakerVoices) {
    try {
      speakerVoices = JSON.parse(episode.speakerVoices)
    } catch {
      speakerVoices = {}
    }
  }

  const text = (line.content || '').trim()
  if (!text) {
    throw new Error('Voice line text is empty')
  }

  const audioSelection = await resolveModelSelectionOrSingle(params.userId, params.audioModel, 'audio')
  const providerKey = getProviderKey(audioSelection.provider).toLowerCase()

  let generated: { audioData: Buffer; audioDuration: number }

  if (providerKey === 'google') {
    const { apiKey } = await getProviderConfig(params.userId, 'google')
    const character = matchCharacterBySpeaker(line.speaker, projectData.characters || [])
    const speakerVoice = speakerVoices[line.speaker]
    const resolvedVoice = character?.voiceId || speakerVoice?.voiceId || undefined
    generated = await generateVoiceWithGoogleTTS({
      text,
      voice: resolvedVoice ?? undefined,
      apiKey,
    })
  } else if (providerKey === 'fal') {
    const character = matchCharacterBySpeaker(line.speaker, projectData.characters || [])
    const speakerVoice = speakerVoices[line.speaker]
    const referenceAudioUrl = character?.customVoiceUrl || speakerVoice?.audioUrl
    if (!referenceAudioUrl) {
      throw new Error('Please set reference audio for this speaker first')
    }

    let fullAudioUrl: string
    if (referenceAudioUrl.startsWith('http') || referenceAudioUrl.startsWith('data:')) {
      fullAudioUrl = referenceAudioUrl
    } else if (referenceAudioUrl.startsWith('/m/')) {
      const storageKey = await resolveStorageKeyFromMediaValue(referenceAudioUrl)
      if (!storageKey) {
        throw new Error(`Cannot resolve reference audio path: ${referenceAudioUrl}`)
      }
      fullAudioUrl = getSignedUrl(storageKey, 3600)
    } else if (referenceAudioUrl.startsWith('/api/files/')) {
      const storageKey = extractCOSKey(referenceAudioUrl)
      fullAudioUrl = storageKey ? getSignedUrl(storageKey, 3600) : referenceAudioUrl
    } else {
      fullAudioUrl = getSignedUrl(referenceAudioUrl, 3600)
    }

    const falApiKey = await getAudioApiKey(params.userId, audioSelection.modelKey)
    generated = await generateVoiceWithIndexTTS2({
      endpoint: audioSelection.modelId,
      referenceAudioUrl: fullAudioUrl,
      text,
      emotionPrompt: line.emotionPrompt,
      strength: line.emotionStrength ?? 0.4,
      falApiKey,
    })
  } else {
    throw new Error(`AUDIO_PROVIDER_UNSUPPORTED: ${audioSelection.provider}`)
  }

  const audioExt = providerKey === 'google' ? 'mp3' : 'wav'
  const audioKey = `voice/${params.projectId}/${episodeId}/${line.id}.${audioExt}`
  const cosKey = await uploadToCOS(generated.audioData, audioKey)

  await checkCancelled?.()

  await prisma.novelPromotionVoiceLine.update({
    where: { id: line.id },
    data: {
      audioUrl: cosKey,
      audioDuration: generated.audioDuration || null,
    },
  })

  const signedUrl = getSignedUrl(cosKey, 7200)
  return {
    lineId: line.id,
    audioUrl: signedUrl,
    storageKey: cosKey,
    audioDuration: generated.audioDuration || null,
  }
}

export function estimateVoiceLineMaxSeconds(content: string | null | undefined) {
  const chars = typeof content === 'string' ? content.length : 0
  return Math.max(5, Math.ceil(chars / 2))
}
