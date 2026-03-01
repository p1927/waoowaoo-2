/**
 * Character profile management hook
 * Unconfirmed profile display and confirm
 * 
 * V6.5: subscribe useProjectAssets, no props drilling
 */

'use client'

import { useState, useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { CharacterProfileData, parseProfileData } from '@/types/character-profile'
import {
    useProjectAssets,
    useRefreshProjectAssets,
    useDeleteProjectCharacter,
    useConfirmProjectCharacterProfile,
    useBatchConfirmProjectCharacterProfiles,
} from '@/lib/query/hooks'

interface UseProfileManagementProps {
    projectId: string
    showToast?: (message: string, type: 'success' | 'warning' | 'error') => void
}

export function useProfileManagement({
    projectId,
    showToast
}: UseProfileManagementProps) {
    const t = useTranslations('assets')
    // Subscribe cache directly
    const { data: assets } = useProjectAssets(projectId)
    const characters = useMemo(() => assets?.characters ?? [], [assets?.characters])

    // Use refetch
    const refreshAssets = useRefreshProjectAssets(projectId)
    const deleteCharacterMutation = useDeleteProjectCharacter(projectId)
    const confirmCharacterProfileMutation = useConfirmProjectCharacterProfile(projectId)
    const batchConfirmProfilesMutation = useBatchConfirmProjectCharacterProfiles(projectId)

    // Use Set for batch confirm
    const [confirmingCharacterIds, setConfirmingCharacterIds] = useState<Set<string>>(new Set())
    const [deletingCharacterId, setDeletingCharacterId] = useState<string | null>(null)
    const [batchConfirming, setBatchConfirming] = useState(false)
    const [editingProfile, setEditingProfile] = useState<{
        characterId: string
        characterName: string
        profileData: CharacterProfileData
    } | null>(null)

    // Get unconfirmed characters
    const unconfirmedCharacters = useMemo(() =>
        characters.filter(char => char.profileData && !char.profileConfirmed),
        [characters]
    )

    // Open edit dialog
    const handleEditProfile = useCallback((characterId: string, characterName: string) => {
        const character = characters.find(c => c.id === characterId)
        if (!character?.profileData) return

        const profileData = parseProfileData(character.profileData)
        if (!profileData) {
            showToast?.(t('characterProfile.parseFailed'), 'error')
            return
        }

        setEditingProfile({ characterId, characterName, profileData })
    }, [characters, showToast, t])

    // Confirm single character
    const handleConfirmProfile = useCallback(async (
        characterId: string,
        updatedProfileData?: CharacterProfileData
    ) => {
        // Add to confirming set
        setConfirmingCharacterIds(prev => new Set(prev).add(characterId))
        try {
            await confirmCharacterProfileMutation.mutateAsync({
                characterId,
                profileData: updatedProfileData,
                generateImage: true,
            })

            showToast?.(t('characterProfile.confirmSuccessGenerating'), 'success')
            refreshAssets()
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : t('common.unknownError')
            showToast?.(t('characterProfile.confirmFailed', { error: message }), 'error')
        } finally {
            // Remove from confirming set
            setConfirmingCharacterIds(prev => {
                const newSet = new Set(prev)
                newSet.delete(characterId)
                return newSet
            })
            setEditingProfile(null)
        }
    }, [confirmCharacterProfileMutation, refreshAssets, showToast, t])

    // Batch confirm all characters
    const handleBatchConfirm = useCallback(async () => {
        if (unconfirmedCharacters.length === 0) {
            showToast?.(t('characterProfile.noPendingCharacters'), 'warning')
            return
        }

        if (!confirm(t('characterProfile.batchConfirmPrompt', { count: unconfirmedCharacters.length }))) {
            return
        }

        setBatchConfirming(true)
        try {
            const result = await batchConfirmProfilesMutation.mutateAsync()
            const confirmedCount = result.count ?? 0
            showToast?.(t('characterProfile.batchConfirmSuccess', { count: confirmedCount }), 'success')
            refreshAssets()
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : t('common.unknownError')
            showToast?.(t('characterProfile.batchConfirmFailed', { error: message }), 'error')
        } finally {
            setBatchConfirming(false)
        }
    }, [batchConfirmProfilesMutation, refreshAssets, showToast, t, unconfirmedCharacters.length])

    // Delete profile (and character)
    const handleDeleteProfile = useCallback(async (characterId: string) => {
        if (!confirm(t('characterProfile.deleteConfirm'))) {
            return
        }

        setDeletingCharacterId(characterId)
        try {
            await deleteCharacterMutation.mutateAsync(characterId)
            showToast?.(t('characterProfile.deleteSuccess'), 'success')
            refreshAssets()
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : t('common.unknownError')
            showToast?.(t('characterProfile.deleteFailed', { error: message }), 'error')
        } finally {
            setDeletingCharacterId(null)
        }
    }, [deleteCharacterMutation, refreshAssets, showToast, t])

    return {
        // Expose characters for component
        characters,
        unconfirmedCharacters,
        confirmingCharacterIds,
        isConfirmingCharacter: (id: string) => confirmingCharacterIds.has(id),
        deletingCharacterId,
        batchConfirming,
        editingProfile,
        handleEditProfile,
        handleConfirmProfile,
        handleBatchConfirm,
        handleDeleteProfile,
        setEditingProfile
    }
}
