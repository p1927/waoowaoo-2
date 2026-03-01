'use client'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

/**
 * useLocationActions - location asset actions
 * CRUD and image generation for locations
 * 
 * V6.5: subscribe useProjectAssets, no props drilling
 */

import { useCallback } from 'react'
import { isAbortError } from '@/lib/error-utils'
import {
    useProjectAssets,
    useRefreshProjectAssets,
    useRegenerateSingleLocationImage,
    useRegenerateLocationGroup,
    useDeleteProjectLocation,
    useSelectProjectLocationImage,
    useConfirmProjectLocationSelection,
    useUpdateProjectLocationDescription,
} from '@/lib/query/hooks'

interface UseLocationActionsProps {
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

export function useLocationActions({
    projectId,
    showToast
}: UseLocationActionsProps) {
    const t = useTranslations('assets')
    // Subscribe cache directly
    const { data: assets } = useProjectAssets(projectId)
    const locations = assets?.locations ?? []

    // Refetch after mutations
    const refreshAssets = useRefreshProjectAssets(projectId)

    // V6.7: use regenerate mutation hooks
    const regenerateSingleImage = useRegenerateSingleLocationImage(projectId)
    const regenerateGroup = useRegenerateLocationGroup(projectId)
    const deleteLocationMutation = useDeleteProjectLocation(projectId)
    const selectLocationImageMutation = useSelectProjectLocationImage(projectId)
    const confirmLocationSelectionMutation = useConfirmProjectLocationSelection(projectId)
    const updateLocationDescriptionMutation = useUpdateProjectLocationDescription(projectId)

    // Delete location
    const handleDeleteLocation = useCallback(async (locationId: string) => {
        if (!confirm(t('location.deleteConfirm'))) return
        try {
            await deleteLocationMutation.mutateAsync(locationId)
        } catch (error: unknown) {
            if (!isAbortError(error)) {
                alert(t('location.deleteFailed', { error: getErrorMessage(error, t('common.unknownError')) }))
            }
        }
    }, [deleteLocationMutation, t])

    // Handle location image selection
    const handleSelectLocationImage = useCallback(async (locationId: string, imageIndex: number | null) => {
        try {
            await selectLocationImageMutation.mutateAsync({ locationId, imageIndex })
        } catch (error: unknown) {
            if (isAbortError(error)) {
                _ulogInfo('Request interrupted (e.g. refresh), backend still running')
                return
            }
            alert(t('image.selectFailed', { error: getErrorMessage(error, t('common.unknownError')) }))
        }
    }, [selectLocationImageMutation, t])

    // Confirm selection and delete other candidates
    const handleConfirmLocationSelection = useCallback(async (locationId: string) => {
        try {
            await confirmLocationSelectionMutation.mutateAsync({ locationId })
            showToast?.(`✓ ${t('image.confirmSuccess')}`, 'success')
        } catch (error: unknown) {
            if (isAbortError(error)) {
                _ulogInfo('Request interrupted (e.g. refresh), backend still running')
                return
            }
            showToast?.(t('image.confirmFailed', { error: getErrorMessage(error, t('common.unknownError')) }), 'error')
        }
    }, [confirmLocationSelectionMutation, showToast, t])

    // Single location image regenerate - mutation hook
    const handleRegenerateSingleLocation = useCallback((locationId: string, imageIndex: number) => {
        regenerateSingleImage.mutate(
            { locationId, imageIndex },
            {
                onError: (error) => {
                    if (!isAbortError(error)) {
                        alert(t('image.regenerateFailed', { error: error.message }))
                    }
                }
            }
        )
    }, [regenerateSingleImage, t])

    // Full location regenerate - mutation hook
    const handleRegenerateLocationGroup = useCallback((locationId: string) => {
        regenerateGroup.mutate(
            { locationId },
            {
                onError: (error) => {
                    if (!isAbortError(error)) {
                        alert(t('image.regenerateFailed', { error: error.message }))
                    }
                }
            }
        )
    }, [regenerateGroup, t])

    // Update location description - save to server
    const handleUpdateLocationDescription = useCallback(async (
        locationId: string,
        newDescription: string
    ) => {
        try {
            await updateLocationDescriptionMutation.mutateAsync({
                locationId,
                description: newDescription,
            })
            refreshAssets()
        } catch (error: unknown) {
            if (!isAbortError(error)) {
                _ulogError('Update descriptionfailed:', getErrorMessage(error, t('common.unknownError')))
            }
        }
    }, [refreshAssets, updateLocationDescriptionMutation, t])

    return {
        // Expose locations for component
        locations,
        handleDeleteLocation,
        handleSelectLocationImage,
        handleConfirmLocationSelection,
        handleRegenerateSingleLocation,
        handleRegenerateLocationGroup,
        handleUpdateLocationDescription
    }
}
