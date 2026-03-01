'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

/**
 * useTTSGeneration - TTS and voice logic
 * Extracted from AssetsStage
 * 
 * V6.5: subscribe useProjectAssets, no props drilling
 */

import { useState } from 'react'
import {
    useProjectAssets,
    useRefreshProjectAssets,
    useUpdateProjectCharacterVoiceSettings,
    useSaveProjectDesignedVoice,
} from '@/lib/query/hooks'

interface VoiceDesignCharacter {
    id: string
    name: string
    hasExistingVoice: boolean
}

interface UseTTSGenerationProps {
    projectId: string
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string') return message
    }
    return fallback
}

export function useTTSGeneration({
    projectId
}: UseTTSGenerationProps) {
    const t = useTranslations('assets')
    // Subscribe cache directly
    const { data: assets } = useProjectAssets(projectId)
    const characters = assets?.characters ?? []

    // Use refetch
    const refreshAssets = useRefreshProjectAssets(projectId)
    const updateVoiceSettingsMutation = useUpdateProjectCharacterVoiceSettings(projectId)
    const saveDesignedVoiceMutation = useSaveProjectDesignedVoice(projectId)

    const [voiceDesignCharacter, setVoiceDesignCharacter] = useState<VoiceDesignCharacter | null>(null)

    // Voice change: save to server, not local
    const handleVoiceChange = async (characterId: string, voiceType: string, voiceId: string, customVoiceUrl?: string) => {
        try {
            await updateVoiceSettingsMutation.mutateAsync({
                characterId,
                voiceType: voiceType as 'custom' | null,
                voiceId,
                customVoiceUrl,
            })

            // Refetch cache
            refreshAssets()
        } catch (error: unknown) {
            _ulogError('Update voicefailed:', getErrorMessage(error, t('common.unknownError')))
        }
    }

    // Open AI voice design dialog
    const handleOpenVoiceDesign = (characterId: string, characterName: string) => {
        const character = characters.find(c => c.id === characterId)
        setVoiceDesignCharacter({
            id: characterId,
            name: characterName,
            hasExistingVoice: !!character?.customVoiceUrl
        })
    }

    // Save AI-designed voice
    const handleVoiceDesignSave = async (voiceId: string, audioBase64: string) => {
        if (!voiceDesignCharacter) return

        try {
            const data = await saveDesignedVoiceMutation.mutateAsync({
                characterId: voiceDesignCharacter.id,
                voiceId,
                audioBase64,
            })
            await handleVoiceChange(voiceDesignCharacter.id, 'custom', voiceId, data.audioUrl)
            alert(t('tts.voiceDesignSaved', { name: voiceDesignCharacter.name }))
        } catch (error: unknown) {
            alert(t('tts.saveVoiceDesignFailed', { error: getErrorMessage(error, t('common.unknownError')) }))
        } finally {
            setVoiceDesignCharacter(null)
        }
    }

    // Close voice design dialog
    const handleCloseVoiceDesign = () => {
        setVoiceDesignCharacter(null)
    }

    return {
        // Expose characters for component
        characters,
        voiceDesignCharacter,
        handleVoiceChange,
        handleOpenVoiceDesign,
        handleVoiceDesignSave,
        handleCloseVoiceDesign
    }
}
