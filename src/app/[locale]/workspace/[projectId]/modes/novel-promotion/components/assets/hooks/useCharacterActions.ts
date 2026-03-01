'use client'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

/**
 * useCharacterActions - character asset actions
 * CRUD and image generation for characters
 * 
 * V6.5: subscribe useProjectAssets, no props drilling
 */

import { useCallback } from 'react'
import { CharacterAppearance } from '@/types/project'
import { isAbortError } from '@/lib/error-utils'
import {
    useProjectAssets,
    useRefreshProjectAssets,
    useRegenerateSingleCharacterImage,
    useRegenerateCharacterGroup,
    useDeleteProjectCharacter,
    useDeleteProjectAppearance,
    useSelectProjectCharacterImage,
    useConfirmProjectCharacterSelection,
    useUpdateProjectAppearanceDescription,
    type Character
} from '@/lib/query/hooks'

interface UseCharacterActionsProps {
    projectId: string
    showToast?: (message: string, type: 'success' | 'warning' | 'error') => void
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string') return message
    }
    return fallback
}

export function useCharacterActions({
    projectId,
    showToast
}: UseCharacterActionsProps) {
    const t = useTranslations('assets')
    // Subscribe cache directly
    const { data: assets } = useProjectAssets(projectId)
    const characters = assets?.characters ?? []

    // Refetch after mutations
    const refreshAssets = useRefreshProjectAssets(projectId)

    // V6.7: use regenerate mutation hooks
    const regenerateSingleImage = useRegenerateSingleCharacterImage(projectId)
    const regenerateGroup = useRegenerateCharacterGroup(projectId)
    const deleteCharacterMutation = useDeleteProjectCharacter(projectId)
    const deleteAppearanceMutation = useDeleteProjectAppearance(projectId)
    const selectCharacterImageMutation = useSelectProjectCharacterImage(projectId)
    const confirmCharacterSelectionMutation = useConfirmProjectCharacterSelection(projectId)
    const updateAppearanceDescriptionMutation = useUpdateProjectAppearanceDescription(projectId)

    // Get appearance list
    const getAppearances = useCallback((character: Character): CharacterAppearance[] => {
        return character.appearances || []
    }, [])

    // Delete character
    const handleDeleteCharacter = useCallback(async (characterId: string) => {
        if (!confirm(t('character.deleteConfirm'))) return
        try {
            await deleteCharacterMutation.mutateAsync(characterId)
        } catch (error: unknown) {
            if (!isAbortError(error)) {
                alert(t('character.deleteFailed', { error: getErrorMessage(error, t('common.unknownError')) }))
            }
        }
    }, [deleteCharacterMutation, t])

    // Delete single appearance
    const handleDeleteAppearance = useCallback(async (characterId: string, appearanceId: string) => {
        if (!confirm(t('character.deleteAppearanceConfirm'))) return
        try {
            await deleteAppearanceMutation.mutateAsync({ characterId, appearanceId })
            // Refetch cache
            refreshAssets()
        } catch (error: unknown) {
            if (!isAbortError(error)) {
                alert(t('character.deleteFailed', { error: getErrorMessage(error, t('common.unknownError')) }))
            }
        }
    }, [deleteAppearanceMutation, refreshAssets, t])

    // Handle character image selection
    const handleSelectCharacterImage = useCallback(async (
        characterId: string,
        appearanceId: string,
        imageIndex: number | null
    ) => {
        try {
            await selectCharacterImageMutation.mutateAsync({
                characterId,
                appearanceId,
                imageIndex,
            })
        } catch (error: unknown) {
            if (isAbortError(error)) {
                _ulogInfo('Request interrupted (e.g. refresh), backend still running')
                return
            }
            alert(t('image.selectFailed', { error: getErrorMessage(error, t('common.unknownError')) }))
        }
    }, [selectCharacterImageMutation, t])

    // Confirm selection and delete other candidates
    const handleConfirmSelection = useCallback(async (characterId: string, appearanceId: string) => {
        try {
            await confirmCharacterSelectionMutation.mutateAsync({ characterId, appearanceId })
            showToast?.(`✓ ${t('image.confirmSuccess')}`, 'success')
        } catch (error: unknown) {
            if (isAbortError(error)) {
                _ulogInfo('Request interrupted (e.g. refresh), backend still running')
                return
            }
            showToast?.(t('image.confirmFailed', { error: getErrorMessage(error, t('common.unknownError')) }), 'error')
        }
    }, [confirmCharacterSelectionMutation, showToast, t])

    // Single character image regenerate - mutation hook
    const handleRegenerateSingleCharacter = useCallback((
        characterId: string,
        appearanceId: string,
        imageIndex: number
    ) => {
        regenerateSingleImage.mutate(
            { characterId, appearanceId, imageIndex },
            {
                onError: (error) => {
                    if (!isAbortError(error)) {
                        alert(t('image.regenerateFailed', { error: error.message }))
                    }
                }
            }
        )
    }, [regenerateSingleImage, t])

    // Full character regenerate - mutation hook
    const handleRegenerateCharacterGroup = useCallback((characterId: string, appearanceId: string) => {
        regenerateGroup.mutate(
            { characterId, appearanceId },
            {
                onError: (error) => {
                    if (!isAbortError(error)) {
                        alert(t('image.regenerateFailed', { error: error.message }))
                    }
                }
            }
        )
    }, [regenerateGroup, t])

    // Update appearance description - save to server
    const handleUpdateAppearanceDescription = useCallback(async (
        characterId: string,
        appearanceId: string,
        newDescription: string,
        descriptionIndex?: number
    ) => {
        try {
            await updateAppearanceDescriptionMutation.mutateAsync({
                characterId,
                appearanceId,
                description: newDescription,
                descriptionIndex,
            })
            refreshAssets()
        } catch (error: unknown) {
            if (!isAbortError(error)) {
                _ulogError('Update descriptionfailed:', getErrorMessage(error, t('common.unknownError')))
            }
        }
    }, [refreshAssets, updateAppearanceDescriptionMutation, t])

    return {
        // Expose characters for component
        characters,
        getAppearances,
        handleDeleteCharacter,
        handleDeleteAppearance,
        handleSelectCharacterImage,
        handleConfirmSelection,
        handleRegenerateSingleCharacter,
        handleRegenerateCharacterGroup,
        handleUpdateAppearanceDescription
    }
}
