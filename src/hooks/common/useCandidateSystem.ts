'use client'

/**
 * useCandidateSystem - Unified candidate image management hook
 * For Panel, Character, Location and any entity that needs candidate image selection.
 *
 * - Init candidate list, select index, get display image
 * - Confirm/cancel selection, undo (previousUrl)
 */

import { useState, useCallback } from 'react'

export interface CandidateState {
    originalUrl: string | null      // Currently confirmed image URL
    candidates: string[]           // Candidate image list
    selectedIndex: number           // Current selection (-1=original, 0-N=candidate)
    previousUrl: string | null     // Previous version URL (undo)
}

export function useCandidateSystem<TId extends string = string>() {
    const [states, setStates] = useState<Map<TId, CandidateState>>(new Map())

    /**
     * Init candidate images for an entity
     */
    const initCandidates = useCallback((
        id: TId,
        originalUrl: string | null,
        candidates: string[],
        previousUrl: string | null = null
    ) => {
        setStates(prev => {
            const next = new Map(prev)
            next.set(id, {
                originalUrl,
                candidates: candidates.filter(c => c && !c.startsWith('PENDING:')), // Filter PENDING
                selectedIndex: 0, // Default first candidate
                previousUrl
            })
            return next
        })
    }, [])

    /**
     * Select candidate index (local state)
     * @param index -1 = original image, 0-N = candidate
     */
    const selectCandidate = useCallback((id: TId, index: number) => {
        setStates(prev => {
            const current = prev.get(id)
            if (!current) return prev

            const next = new Map(prev)
            next.set(id, { ...current, selectedIndex: index })
            return next
        })
    }, [])

    /**
     * Get currently displayed image URL
     */
    const getDisplayImage = useCallback((id: TId, fallback: string | null = null): string | null => {
        const state = states.get(id)
        if (!state || state.candidates.length === 0) return fallback

        if (state.selectedIndex === -1) {
            return state.originalUrl || fallback
        }

        return state.candidates[state.selectedIndex] ?? fallback
    }, [states])

    /**
     * Get confirm payload for API
     * @returns Selected URL or null
     */
    const getConfirmData = useCallback((id: TId): { selectedUrl: string } | null => {
        const state = states.get(id)
        if (!state || state.candidates.length === 0) return null

        if (state.selectedIndex === -1) {
            // Original image
            if (!state.originalUrl) return null
            return { selectedUrl: state.originalUrl }
        }

        const selectedUrl = state.candidates[state.selectedIndex]
        if (!selectedUrl) return null
        return { selectedUrl }
    }, [states])

    /**
     * Clear candidate state
     */
    const clearCandidates = useCallback((id: TId) => {
        setStates(prev => {
            if (!prev.has(id)) return prev
            const next = new Map(prev)
            next.delete(id)
            return next
        })
    }, [])

    /**
     * Whether entity has candidates
     */
    const hasCandidates = useCallback((id: TId): boolean => {
        const state = states.get(id)
        return !!state && state.candidates.length > 0
    }, [states])

    /**
     * Whether undo is available
     */
    const canUndo = useCallback((id: TId): boolean => {
        const state = states.get(id)
        return !!state?.previousUrl
    }, [states])

    /**
     * Get candidate state for UI
     */
    const getCandidateState = useCallback((id: TId): CandidateState | null => {
        return states.get(id) ?? null
    }, [states])

    return {
        states,
        initCandidates,
        selectCandidate,
        getDisplayImage,
        getConfirmData,
        clearCandidates,
        hasCandidates,
        canUndo,
        getCandidateState
    }
}
