import { logError as _ulogError } from '@/lib/logging/core'
/**
 * AI design shared utilities
 * Shared AI design logic for Asset Hub and Novel Promotion
 */

import { executeAiTextStep } from '@/lib/ai-runtime'
import { withTextBilling } from '@/lib/billing'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import type { ContentLocale } from '@/lib/prompt-i18n'

export type AssetType = 'character' | 'location'

export interface AIDesignOptions {
    userId: string
    locale: ContentLocale
    analysisModel: string
    userInstruction: string
    assetType: AssetType
    /** Billing context: 'asset-hub' or actual projectId */
    projectId?: string
    /** When run inside task worker, skip billing to avoid double charge */
    skipBilling?: boolean
}

export interface AIDesignResult {
    success: boolean
    prompt?: string
    error?: string
}

/**
 * AI design: generate character or location prompt from user instruction
 */
export async function aiDesign(options: AIDesignOptions): Promise<AIDesignResult> {
    const {
        userId,
        locale,
        analysisModel,
        userInstruction,
        assetType,
        projectId = 'asset-hub',
        skipBilling = false,
    } = options

    if (!userInstruction?.trim()) {
        return {
            success: false,
            error: assetType === 'character' ? 'Please enter character design requirements' : 'Please enter location design requirements'
        }
    }

    if (!analysisModel) {
        return {
            success: false,
            error: 'Please set the analysis model in user settings first'
        }
    }

    let finalPrompt: string
    try {
        finalPrompt = buildPrompt({
            promptId: assetType === 'character'
                ? PROMPT_IDS.NP_CHARACTER_CREATE
                : PROMPT_IDS.NP_LOCATION_CREATE,
            locale,
            variables: {
                user_input: userInstruction,
            },
        })
    } catch {
        _ulogError('[AI Design] Prompt load failed')
        return { success: false, error: 'System config error' }
    }

    // Call LLM
    const action = assetType === 'character' ? 'ai_design_character' : 'ai_design_location'
    const maxInputTokens = Math.max(1200, Math.ceil(finalPrompt.length * 1.2))
    const maxOutputTokens = 1200
    const runCompletion = async () =>
        await executeAiTextStep({
            userId,
            model: analysisModel,
            messages: [{ role: 'user', content: finalPrompt }],
            temperature: 0.7,
            projectId,
            action,
            meta: {
                stepId: action,
                stepTitle: assetType === 'character' ? 'Character design' : 'Location design',
                stepIndex: 1,
                stepTotal: 1,
            },
        })
    const completion = skipBilling
        ? await runCompletion()
        : await withTextBilling(
            userId,
            analysisModel,
            maxInputTokens,
            maxOutputTokens,
            { projectId, action, metadata: { assetType } },
            runCompletion,
        )

    const aiResponse = completion.text

    if (!aiResponse) {
        return { success: false, error: 'AI returned empty content' }
    }

    // Parse JSON response
    let parsedResponse
    try {
        parsedResponse = JSON.parse(aiResponse)
    } catch {
        const jsonMatch = aiResponse.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
            try {
                parsedResponse = JSON.parse(jsonMatch[0])
            } catch {
                _ulogError('[AI Design] AI response parse failed:', aiResponse)
                return { success: false, error: 'AI response format error' }
            }
        } else {
            _ulogError('[AI Design] AI response parse failed:', aiResponse)
            return { success: false, error: 'AI response format error' }
        }
    }

    if (!parsedResponse.prompt) {
        return { success: false, error: 'AI response missing prompt field' }
    }

    return {
        success: true,
        prompt: parsedResponse.prompt
    }
}
