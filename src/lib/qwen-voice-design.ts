import { logInfo as _ulogInfo } from '@/lib/logging/core'
/**
 * Aliyun qwen-voice-design API integration.
 * 1. Call createVoiceDesign() to create a custom voice
 * 2. Use the returned voice ID for TTS calls
 */

export interface VoiceDesignInput {
    /** Voice prompt describing desired voice */
    voicePrompt: string
    /** Preview text for preview audio */
    previewText: string
    /** Optional voice name */
    preferredName?: string
    /** Language, default zh */
    language?: 'zh' | 'en'
}

export interface VoiceDesignResult {
    success: boolean
    voiceId?: string
    targetModel?: string
    audioBase64?: string
    sampleRate?: number
    responseFormat?: string
    usageCount?: number
    requestId?: string
    error?: string
    errorCode?: string
}

/**
 * Call Aliyun qwen-voice-design API to create custom voice.
 */
export async function createVoiceDesign(input: VoiceDesignInput, apiKey: string): Promise<VoiceDesignResult> {
    if (!apiKey) {
        return {
            success: false,
            error: 'Please configure Aliyun DashScope API Key'
        }
    }

    const requestBody = {
        model: 'qwen-voice-design',
        input: {
            action: 'create',
            target_model: 'qwen3-tts-vd-realtime-2025-12-16',
            voice_prompt: input.voicePrompt,
            preview_text: input.previewText,
            preferred_name: input.preferredName || 'custom_voice',
            language: input.language || 'zh'
        },
        parameters: {
            sample_rate: 24000,
            response_format: 'wav'
        }
    }

    _ulogInfo('[VoiceDesign] Request body:', JSON.stringify(requestBody, null, 2))

    try {
        const response = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        })

        const data = await response.json()

        if (response.ok && data.output) {
            return {
                success: true,
                voiceId: data.output.voice,
                targetModel: data.output.target_model,
                audioBase64: data.output.preview_audio?.data,
                sampleRate: data.output.preview_audio?.sample_rate,
                responseFormat: data.output.preview_audio?.response_format,
                usageCount: data.usage?.count,
                requestId: data.request_id
            }
        } else {
            return {
                success: false,
                error: data.message || 'Voice design API call failed',
                errorCode: data.code,
                requestId: data.request_id
            }
        }

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Network request failed'
        return {
            success: false,
            error: message || 'Network request failed'
        }
    }
}

/**
 * Validate voice prompt.
 */
export function validateVoicePrompt(voicePrompt: string): { valid: boolean; error?: string } {
    if (!voicePrompt || voicePrompt.trim().length === 0) {
        return { valid: false, error: 'Voice prompt cannot be empty' }
    }

    if (voicePrompt.length > 500) {
        return { valid: false, error: 'Voice prompt must be at most 500 characters' }
    }

    return { valid: true }
}

/**
 * Validate preview text.
 */
export function validatePreviewText(previewText: string): { valid: boolean; error?: string } {
    if (!previewText || previewText.trim().length === 0) {
        return { valid: false, error: 'Preview text cannot be empty' }
    }

    if (previewText.length < 5) {
        return { valid: false, error: 'Preview text must be at least 5 characters' }
    }

    if (previewText.length > 200) {
        return { valid: false, error: 'Preview text must be at most 200 characters' }
    }

    return { valid: true }
}
