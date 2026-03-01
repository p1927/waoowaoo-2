/**
 * Type guards and utility types for storyboard
 * Resolves (storyboard as any).panels type assertion issue
 */

import { NovelPromotionStoryboard, NovelPromotionPanel } from './project'

/**
 * Storyboard type with loaded panels
 * Used when database query includes panels
 */
export interface StoryboardWithPanels extends NovelPromotionStoryboard {
    panels: NovelPromotionPanel[]
}

/**
 * Type guard: check if storyboard contains loaded panels
 */
export function hasLoadedPanels(
    storyboard: NovelPromotionStoryboard
): storyboard is StoryboardWithPanels {
    return Array.isArray((storyboard as StoryboardWithPanels).panels)
}

/**
 * Safely get panels array
 * Returns empty array if panels do not exist
 */
export function getPanels(storyboard: NovelPromotionStoryboard): NovelPromotionPanel[] {
    if (hasLoadedPanels(storyboard)) {
        return storyboard.panels
    }
    return []
}

/**
 * Get panel candidate images
 * Handles candidateImages JSON string parsing
 */
export function getPanelCandidates(panel: NovelPromotionPanel): string[] {
    if (!panel.imageHistory) return []
    try {
        const parsed = JSON.parse(panel.imageHistory)
        return Array.isArray(parsed) ? parsed : []
    } catch {
        return []
    }
}
