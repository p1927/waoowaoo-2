/**
* Alibaba Qwen TTS generator
 *
 * Supports:
 * - Qwen TTS
 */

import { BaseAudioGenerator, AudioGenerateParams, GenerateResult } from '../base'
import { getProviderConfig } from '@/lib/api-config'

export class QwenTTSGenerator extends BaseAudioGenerator {
    protected async doGenerate(params: AudioGenerateParams): Promise<GenerateResult> {
        const { userId, text, voice = 'default', rate = 1.0 } = params

        const { apiKey } = await getProviderConfig(userId, 'qwen')

        const body = {
            text,
            voice,
            rate
        }

        // Call Alibaba Qwen TTS API
        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/audio/tts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Qwen TTS failed (${response.status}): ${errorText}`)
        }

        const data = await response.json()
        const audioUrl = data.audio_url || data.output?.audio_url

        if (!audioUrl) {
            throw new Error('Qwen did not return audio URL')
        }

        return {
            success: true,
            audioUrl
        }
    }
}
