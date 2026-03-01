'use client'
import { logError as _ulogError } from '@/lib/logging/core'

/**
 * useBatchGeneration - batch asset image generation
 * Extracted from AssetsStage
 * 
 * V6.5: subscribe useProjectAssets, no props drilling
 * V6.6: internal mutation hooks, no onGenerateImage
 */

import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { CharacterAppearance } from '@/types/project'
import { useProjectAssets, useRefreshProjectAssets, useGenerateProjectCharacterImage, useGenerateProjectLocationImage, type Character } from '@/lib/query/hooks'
import {
    createManualKeyBaseline,
    isAppearanceTaskRunning,
    shouldResolveManualKey,
    type ManualRegenerationBaseline,
} from './useBatchGeneration.helpers'

interface UseBatchGenerationProps {
    projectId: string
    // V6.6: use internal mutation hooks
    handleGenerateImage?: (type: 'character' | 'location', id: string, appearanceId?: string) => Promise<void> | void
}

export function useBatchGeneration({
    projectId,
    handleGenerateImage: externalHandleGenerateImage
}: UseBatchGenerationProps) {
    const t = useTranslations('assets')
    // Subscribe cache directly
    const { data: assets } = useProjectAssets(projectId)
    const characters = useMemo(() => assets?.characters ?? [], [assets?.characters])
    const locations = useMemo(() => assets?.locations ?? [], [assets?.locations])

    // Use refetch
    const refreshAssets = useRefreshProjectAssets(projectId)

    // V6.6: internal mutation hooks
    const generateCharacterImage = useGenerateProjectCharacterImage(projectId)
    const generateLocationImage = useGenerateProjectLocationImage(projectId)

    // Internal image generation
    const internalHandleGenerateImage = useCallback(async (type: 'character' | 'location', id: string, appearanceId?: string) => {
        if (type === 'character' && appearanceId) {
            await generateCharacterImage.mutateAsync({ characterId: id, appearanceId })
        } else if (type === 'location') {
            await generateLocationImage.mutateAsync({ locationId: id, imageIndex: 0 })
        }
    }, [generateCharacterImage, generateLocationImage])

    // Use external fn or internal
    const handleGenerateImage = externalHandleGenerateImage || internalHandleGenerateImage

    const [isBatchSubmittingAll, setIsBatchSubmittingAll] = useState(false)
    const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 })
    const [pendingRegenerationKeys, setPendingRegenerationKeys] = useState<Set<string>>(new Set())
    const [pendingRegenerationBaselines, setPendingRegenerationBaselines] = useState<Map<string, ManualRegenerationBaseline>>(new Map())

    // Get appearance list (built-in)
    const getAppearances = useCallback((character: Character): CharacterAppearance[] => {
        return character.appearances || []
    }, [])

    const activeTaskKeys = useMemo(() => {
        const generated = new Set<string>()

        for (const character of characters) {
            for (const appearance of character.appearances || []) {
                if (!isAppearanceTaskRunning(appearance)) continue
                const groupKey = `character-${character.id}-${appearance.appearanceIndex}-group`
                generated.add(groupKey)
                const imageCount = Math.max(1, appearance.imageUrls?.length || 0)
                for (let index = 0; index < imageCount; index += 1) {
                    generated.add(`character-${character.id}-${appearance.appearanceIndex}-${index}`)
                }
            }
        }

        for (const location of locations) {
            const hasRunningTask = !!location.images?.some((img) => img.imageTaskRunning)
            if (!hasRunningTask) continue
            generated.add(`location-${location.id}-group`)
            for (const image of location.images || []) {
                if (image.imageTaskRunning) {
                    generated.add(`location-${location.id}-${image.imageIndex}`)
                }
            }
        }

        for (const key of pendingRegenerationKeys) {
            generated.add(key)
        }

        return generated
    }, [characters, locations, pendingRegenerationKeys])

    useEffect(() => {
        if (pendingRegenerationKeys.size === 0) return

        const now = Date.now()
        setPendingRegenerationKeys((prev) => {
            let changed = false
            const next = new Set(prev)
            for (const key of prev) {
                if (shouldResolveManualKey(key, characters, locations, pendingRegenerationBaselines, now)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
        setPendingRegenerationBaselines((prev) => {
            if (prev.size === 0) return prev
            let changed = false
            const next = new Map(prev)
            for (const key of Array.from(next.keys())) {
                if (!pendingRegenerationKeys.has(key)) {
                    next.delete(key)
                    changed = true
                    continue
                }
                if (shouldResolveManualKey(key, characters, locations, prev, now)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [characters, locations, pendingRegenerationBaselines, pendingRegenerationKeys])

    // Generate all missing asset images
    const handleGenerateAllImages = async () => {
        const tasks: Array<{
            type: 'character' | 'location'
            id: string
            appearanceId?: string
            appearanceIndex?: number
            key: string
        }> = []

        // Collect character assets
        characters.forEach(char => {
            const appearances = getAppearances(char)
            appearances.forEach(app => {
                if (!app.imageUrl && !app.imageUrls?.length) {
                    tasks.push({
                        type: 'character',
                        id: char.id,
                        appearanceId: app.id,
                        appearanceIndex: app.appearanceIndex,
                        key: `character-${char.id}-${app.appearanceIndex}-group`
                    })
                }
            })
        })

        // Collect location assets
        locations.forEach(loc => {
            const hasImage = loc.images?.some(img => img.imageUrl)
            if (!hasImage) {
                tasks.push({
                    type: 'location',
                    id: loc.id,
                    key: `location-${loc.id}-group`
                })
            }
        })

        if (tasks.length === 0) {
            alert(t('toolbar.generateAllNoop'))
            return
        }

        setIsBatchSubmittingAll(true)
        setBatchProgress({ current: 0, total: tasks.length })

        const allKeys = new Set(tasks.map(t => t.key))
        setPendingRegenerationKeys(prev => new Set([...prev, ...allKeys]))
        setPendingRegenerationBaselines(prev => {
            const next = new Map(prev)
            for (const key of allKeys) {
                const baseline = createManualKeyBaseline(key, characters, locations)
                if (baseline) {
                    next.set(key, baseline)
                }
            }
            return next
        })

        try {
            await Promise.all(
                tasks.map(async (task) => {
                    let submitted = false
                    try {
                        await handleGenerateImage(task.type, task.id, task.appearanceId)
                        submitted = true
                        setBatchProgress(prev => ({ ...prev, current: prev.current + 1 }))
                    } catch (error) {
                        _ulogError(`Failed to generate ${task.type} ${task.id}:`, error)
                        setBatchProgress(prev => ({ ...prev, current: prev.current + 1 }))
                    } finally {
                        if (submitted) return
                        setPendingRegenerationKeys(prev => {
                            const next = new Set(prev)
                            next.delete(task.key)
                            return next
                        })
                        setPendingRegenerationBaselines(prev => {
                            if (!prev.has(task.key)) return prev
                            const next = new Map(prev)
                            next.delete(task.key)
                            return next
                        })
                    }
                })
            )
        } finally {
            setIsBatchSubmittingAll(false)
            setBatchProgress({ current: 0, total: 0 })
            refreshAssets()
        }
    }

    // Regenerate all asset images
    const handleRegenerateAllImages = async () => {
        if (!confirm(t('toolbar.regenerateAllConfirm'))) return

        const tasks: Array<{
            type: 'character' | 'location'
            id: string
            appearanceId?: string
            appearanceIndex?: number
            key: string
        }> = []

        characters.forEach(char => {
            const appearances = getAppearances(char)
            appearances.forEach(app => {
                tasks.push({
                    type: 'character',
                    id: char.id,
                    appearanceId: app.id,
                    appearanceIndex: app.appearanceIndex,
                    key: `character-${char.id}-${app.appearanceIndex}-group`
                })
            })
        })

        locations.forEach(loc => {
            tasks.push({
                type: 'location',
                id: loc.id,
                key: `location-${loc.id}-group`
            })
        })

        if (tasks.length === 0) {
            alert(t('toolbar.noAssetsToGenerate'))
            return
        }

        setIsBatchSubmittingAll(true)
        setBatchProgress({ current: 0, total: tasks.length })

        const allKeys = new Set(tasks.map(t => t.key))
        setPendingRegenerationKeys(prev => new Set([...prev, ...allKeys]))
        setPendingRegenerationBaselines(prev => {
            const next = new Map(prev)
            for (const key of allKeys) {
                const baseline = createManualKeyBaseline(key, characters, locations)
                if (baseline) {
                    next.set(key, baseline)
                }
            }
            return next
        })

        try {
            await Promise.all(
                tasks.map(async (task) => {
                    let submitted = false
                    try {
                        await handleGenerateImage(task.type, task.id, task.appearanceId)
                        submitted = true
                        setBatchProgress(prev => ({ ...prev, current: prev.current + 1 }))
                    } catch (error) {
                        _ulogError(`Failed to generate ${task.type} ${task.id}:`, error)
                        setBatchProgress(prev => ({ ...prev, current: prev.current + 1 }))
                    } finally {
                        if (submitted) return
                        setPendingRegenerationKeys(prev => {
                            const next = new Set(prev)
                            next.delete(task.key)
                            return next
                        })
                        setPendingRegenerationBaselines(prev => {
                            if (!prev.has(task.key)) return prev
                            const next = new Map(prev)
                            next.delete(task.key)
                            return next
                        })
                    }
                })
            )
        } finally {
            setIsBatchSubmittingAll(false)
            setBatchProgress({ current: 0, total: 0 })
            refreshAssets()
        }
    }

    // Clear single fallback (submit failed only)
    const clearTransientTaskKey = useCallback((key: string) => {
        setPendingRegenerationKeys(prev => {
            const next = new Set(prev)
            next.delete(key)
            return next
        })
        setPendingRegenerationBaselines(prev => {
            if (!prev.has(key)) return prev
            const next = new Map(prev)
            next.delete(key)
            return next
        })
    }, [])

    return {
        // Expose data for component
        characters,
        locations,
        getAppearances,
        // State
        isBatchSubmitting: isBatchSubmittingAll,
        batchProgress,
        activeTaskKeys,
        setTransientRegenerationKeys: setPendingRegenerationKeys,
        clearTransientTaskKey,
        // Actions
        handleGenerateAllImages,
        handleRegenerateAllImages
    }
}
