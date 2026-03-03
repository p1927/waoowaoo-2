/**
 * Google Cloud Text-to-Speech generator
 *
 * Uses predefined voices (no voice cloning).
 * API: https://texttospeech.googleapis.com/v1/text:synthesize
 * Auth: API key (same as Google AI Studio / Gemini)
 */

import { BaseAudioGenerator, AudioGenerateParams, GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'

const GOOGLE_TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'
const DEFAULT_VOICE = 'en-US-Neural2-F'
const DEFAULT_LANGUAGE = 'en-US'

interface GoogleTTSSynthesizeRequest {
    input: { text: string }
    voice: { languageCode: string; name: string }
    audioConfig: { audioEncoding: 'MP3' | 'LINEAR16' | 'OGG_OPUS' }
}

interface GoogleTTSSynthesizeResponse {
    audioContent: string
}

function extractLanguageCode(voiceName: string): string {
    const parts = voiceName.split('-')
    if (parts.length >= 2) {
        return `${parts[0]}-${parts[1]}`
    }
    return DEFAULT_LANGUAGE
}

export class GoogleCloudTTSGenerator extends BaseAudioGenerator {
    protected async doGenerate(params: AudioGenerateParams): Promise<GenerateResult> {
        const { userId, text, voice } = params

        const { apiKey } = await getProviderConfig(userId, 'google')

        const voiceName = voice && voice !== 'default' ? voice : DEFAULT_VOICE
        const languageCode = extractLanguageCode(voiceName)

        const requestBody: GoogleTTSSynthesizeRequest = {
            input: { text },
            voice: { languageCode, name: voiceName },
            audioConfig: { audioEncoding: 'MP3' },
        }

        const response = await fetch(`${GOOGLE_TTS_URL}?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Google Cloud TTS failed (${response.status}): ${errorText}`)
        }

        const data = (await response.json()) as GoogleTTSSynthesizeResponse

        if (!data.audioContent) {
            throw new Error('Google Cloud TTS did not return audio content')
        }

        return {
            success: true,
            audioUrl: `data:audio/mp3;base64,${data.audioContent}`,
        }
    }
}
