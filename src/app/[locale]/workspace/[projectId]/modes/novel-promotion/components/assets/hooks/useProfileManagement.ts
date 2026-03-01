/**
 * 角色档案管理 Hook
 * 处理未确认档案的显示和确认逻辑
 * 
 * 🔥 V6.5 重构：直接订阅 useProjectAssets，消除 props drilling
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
    // 🔥 直接订阅缓存 - 消除 props drilling
    const { data: assets } = useProjectAssets(projectId)
    const characters = useMemo(() => assets?.characters ?? [], [assets?.characters])

    // 🔥 使用刷新函数
    const refreshAssets = useRefreshProjectAssets(projectId)
    const deleteCharacterMutation = useDeleteProjectCharacter(projectId)
    const confirmCharacterProfileMutation = useConfirmProjectCharacterProfile(projectId)
    const batchConfirmProfilesMutation = useBatchConfirmProjectCharacterProfiles(projectId)

    // 🔥 修复：使用 Set 支持同时确认多个角色
    const [confirmingCharacterIds, setConfirmingCharacterIds] = useState<Set<string>>(new Set())
    const [deletingCharacterId, setDeletingCharacterId] = useState<string | null>(null)
    const [batchConfirming, setBatchConfirming] = useState(false)
    const [editingProfile, setEditingProfile] = useState<{
        characterId: string
        characterName: string
        profileData: CharacterProfileData
    } | null>(null)

    // 获取未确认的角色
    const unconfirmedCharacters = useMemo(() =>
        characters.filter(char => char.profileData && !char.profileConfirmed),
        [characters]
    )

    // 打开编辑对话框
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

    // 确认单个角色
    const handleConfirmProfile = useCallback(async (
        characterId: string,
        updatedProfileData?: CharacterProfileData
    ) => {
        // 🔥 添加到确认中集合
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
            // 🔥 从确认中集合移除
            setConfirmingCharacterIds(prev => {
                const newSet = new Set(prev)
                newSet.delete(characterId)
                return newSet
            })
            setEditingProfile(null)
        }
    }, [confirmCharacterProfileMutation, refreshAssets, showToast, t])

    // 批量确认所有角色
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

    // Delete character档案（同时Delete character）
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
        // 🔥 暴露 characters 供组件使用
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
