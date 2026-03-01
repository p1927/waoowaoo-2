'use client'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

import { useState, useCallback } from 'react'
import { useCreateProjectPanelVariant, useRefreshEpisodeData } from '@/lib/query/hooks'
import { NovelPromotionStoryboard, NovelPromotionPanel } from '@/types/project'

/**
 * usePanelVariant - Shot variant operations Hook
 *
 * Manages shot variant state and actions
 * Uses optimistic update: insert placeholder panel immediately on click, no wait for API
 */

export interface VariantData {
    title: string
    description: string
    shot_type: string
    camera_move: string
    video_prompt: string
}

export interface VariantOptions {
    includeCharacterAssets: boolean
    includeLocationAsset: boolean
}

interface VariantModalState {
    panelId: string
    panelNumber: number | null
    description: string | null
    imageUrl: string | null
    storyboardId: string
}

interface UsePanelVariantProps {
    projectId: string
    episodeId: string
    // Requires setLocalStoryboards for optimistic update
    setLocalStoryboards: React.Dispatch<React.SetStateAction<NovelPromotionStoryboard[]>>
}

export function usePanelVariant({ projectId, episodeId, setLocalStoryboards }: UsePanelVariantProps) {
    const t = useTranslations('storyboard')
    // Use React Query refresh - refreshes episodeData (storyboards and panels)
    const onRefresh = useRefreshEpisodeData(projectId, episodeId)
    const createPanelVariantMutation = useCreateProjectPanelVariant(projectId)
    // Variant modal state
    const [variantModalState, setVariantModalState] = useState<VariantModalState | null>(null)

    // Panel ID currently submitting variant task
    const [submittingVariantPanelId, setSubmittingVariantPanelId] = useState<string | null>(null)

    // Open variant modal
    const openVariantModal = useCallback((panel: VariantModalState) => {
        setVariantModalState(panel)
    }, [])

    // Close variant modal
    const closeVariantModal = useCallback(() => {
        setVariantModalState(null)
    }, [])

    // Execute variant generation
    const generatePanelVariant = useCallback(async (
        sourcePanelId: string,
        storyboardId: string,
        insertAfterPanelId: string,
        variant: VariantData,
        options: VariantOptions
    ): Promise<void> => {
        setSubmittingVariantPanelId(sourcePanelId)

        // Optimistic update: insert temp placeholder panel in local state immediately
        const tempPanelId = `temp-variant-${Date.now()}`
        setLocalStoryboards(prev => prev.map(sb => {
            if (sb.id !== storyboardId) return sb

            // Find insert position
            const panels: NovelPromotionPanel[] = sb.panels || []
            const insertIndex = panels.findIndex((panel) => panel.id === insertAfterPanelId)
            if (insertIndex === -1) return sb

            // Create temp placeholder panel
            const tempPanel: NovelPromotionPanel = {
                id: tempPanelId,
                storyboardId,
                panelIndex: insertIndex + 1,
                panelNumber: (panels[insertIndex]?.panelNumber || 0) + 0.5, // Temp number
                description: variant.description || t('variant.generating'),
                shotType: variant.shot_type || null,
                cameraMove: variant.camera_move || null,
                videoPrompt: variant.video_prompt || null,
                imageUrl: null,
                imageTaskRunning: true, // Show loading state
                characters: null,
                location: null,
                candidateImages: null,
                srtSegment: null,
                srtStart: null,
                srtEnd: null,
                duration: null,
                imagePrompt: null,
                media: null,
                imageHistory: null,
                videoUrl: null,
                videoMedia: null,
                lipSyncVideoUrl: null,
                lipSyncVideoMedia: null,
                sketchImageUrl: null,
                sketchImageMedia: null,
                previousImageUrl: null,
                previousImageMedia: null,
                photographyRules: null,
                actingNotes: null,
                imageErrorMessage: null,
            }

            // Insert temp panel
            const newPanels = [
                ...panels.slice(0, insertIndex + 1),
                tempPanel,
                ...panels.slice(insertIndex + 1)
            ]

            _ulogInfo('[usePanelVariant] Optimistic update: inserted temp placeholder panel', tempPanelId)

            return {
                ...sb,
                panels: newPanels
            }
        }))

        // Close modal immediately (don't wait for API)
        setVariantModalState(null)

        try {
            const data = await createPanelVariantMutation.mutateAsync({
                storyboardId,
                insertAfterPanelId,
                sourcePanelId,
                variant,
                includeCharacterAssets: options.includeCharacterAssets,
                includeLocationAsset: options.includeLocationAsset,
            })

            // API success: Panel created on server (no image), replace temp ID with real panelId
            // So task state monitoring can match this panel correctly
            const realPanelId = data?.panelId
            _ulogInfo('[usePanelVariant] API success, realPanelId:', realPanelId)

            if (realPanelId) {
                setLocalStoryboards(prev => prev.map(sb => {
                    if (sb.id !== storyboardId) return sb
                    const panels = (sb.panels || []).map(p =>
                        p.id === tempPanelId ? { ...p, id: realPanelId } : p,
                    )
                    return { ...sb, panels }
                }))
            }

            // Refresh to get full server state
            if (onRefresh) {
                await onRefresh()
            }
        } catch (error) {
            // API failed: remove temp panel and show error
            setLocalStoryboards(prev => prev.map(sb => {
                if (sb.id !== storyboardId) return sb
                const panels = (sb.panels || []).filter((panel) => panel.id !== tempPanelId)
                return { ...sb, panels }
            }))
            _ulogError('[usePanelVariant] Generate variant failed:', error)
            throw error
        } finally {
            setSubmittingVariantPanelId(null)
        }
    }, [createPanelVariantMutation, onRefresh, setLocalStoryboards, t])

    // Handle variant selection in modal
    const handleVariantSelect = useCallback(async (
        variant: VariantData,
        options: VariantOptions
    ) => {
        if (!variantModalState) return

        // Insert variant after source panel
        await generatePanelVariant(
            variantModalState.panelId,
            variantModalState.storyboardId,
            variantModalState.panelId, // Insert after current panel
            variant,
            options
        )
    }, [variantModalState, generatePanelVariant])

    return {
        // State
        variantModalState,
        submittingVariantPanelId,
        isVariantModalOpen: !!variantModalState,
        isSubmittingVariantTask: !!submittingVariantPanelId,

        // Actions
        openVariantModal,
        closeVariantModal,
        generatePanelVariant,
        handleVariantSelect
    }
}
