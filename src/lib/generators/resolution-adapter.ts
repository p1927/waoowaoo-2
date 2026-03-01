import { logInfo as _ulogInfo, logWarn as _ulogWarn } from '@/lib/logging/core'
/**
 * Centralized video resolution adapter
 *
 * Responsibilities:
 * - Convert user's generic resolution config (720p/1080p/4K etc.) to model-specific formats
 * - Centralize resolution mapping rules for all models
 * - Simplify maintenance
 *
 * Usage:
 * ```typescript
 * const resolution = adaptVideoResolution('minimax', '1080p')
 * // Returns: '1080P'
 * ```
 */

// ============================================================
// Type definitions
// ============================================================

export type VideoProvider = 'minimax' | 'fal' | 'ark' | 'vidu'

// ============================================================
// Resolution adapter rules
// ============================================================

/**
 * Resolution adapter rules per model
 * key: provider name
 * value: adapter function
 */
const RESOLUTION_ADAPTERS: Record<VideoProvider, (input: string) => string> = {
    /**
     * MiniMax
     * Supports: 768P, 1080P
     *
     * Mapping:
     * - 720p/768p → 768P (SD)
     * - 1080p and above → 1080P (HD, max supported)
     */
    minimax: (input: string): string => {
        const normalized = input.toLowerCase().replace(/[^0-9kp]/g, '')

        // 720p series → 768P
        if (normalized.includes('720') || normalized.includes('768')) {
            return '768P'
        }

        // 1080p and above all map to 1080P (MiniMax max supported)
        return '1080P'
    },

    /**
     * FAL model
     * Supports: 720p, 1080p, 1440p, 4K
     *
     * FAL supports standard resolutions directly, no conversion needed, only format normalization
     */
    fal: (input: string): string => {
        const normalized = input.toLowerCase()

        if (normalized.includes('720')) return '720p'
        if (normalized.includes('1080')) return '1080p'
        if (normalized.includes('1440') || normalized.includes('2k')) return '1440p'
        if (normalized.includes('4k')) return '4K'

        return '1080p' // Default 1080p
    },

    /**
     * Ark model (Seedance etc.)
     * Supports: 720p, 1080p
     *
     * Mapping:
     * - 720p and below → 720p
     * - 1080p and above → 1080p
     */
    ark: (input: string): string => {
        const normalized = input.toLowerCase()

        if (normalized.includes('720')) return '720p'
        return '1080p' // Default and above 1080p all map to 1080p
    },

    /**
     * Vidu model (adjust per actual support)
     * Supports: 720p, 1080p, 2K
     *
     * Mapping:
     * - 720p → 720p
     * - 1080p → 1080p
     * - 1440p/2K/4K → 2K
     */
    vidu: (input: string): string => {
        const normalized = input.toLowerCase()

        if (normalized.includes('720')) return '720p'
        if (normalized.includes('1440') || normalized.includes('2k') || normalized.includes('4k')) {
            return '2K'
        }
        return '1080p' // Default 1080p
    }
}

// ============================================================
// Public API
// ============================================================

/**
 * Adapt video resolution for provider
 *
 * @param provider - Model provider
 * @param inputResolution - User-configured resolution (e.g. '720p', '1080p', '4K')
 * @returns Adapted resolution (conforms to model spec)
 *
 * @example
 * adaptVideoResolution('minimax', '720p')  // Returns: '768P'
 * adaptVideoResolution('minimax', '1080p') // Returns: '1080P'
 * adaptVideoResolution('fal', '1080p')     // Returns: '1080p'
 */
export function adaptVideoResolution(
    provider: string,
    inputResolution: string
): string {
    const adapter = RESOLUTION_ADAPTERS[provider as VideoProvider]

    if (!adapter) {
        _ulogWarn(`[Resolution Adapter] Unknown provider: ${provider}, using original: ${inputResolution}`)
        return inputResolution
    }

    const adapted = adapter(inputResolution)
    _ulogInfo(`[Resolution Adapter] provider=${provider}, input=${inputResolution} → adapted=${adapted}`)
    return adapted
}

/**
 * Get supported resolution list for model (for UI display)
 *
 * @param provider - Model provider
 * @returns Supported resolution list
 */
export function getSupportedResolutions(provider: string): string[] {
    const resolutionMap: Record<VideoProvider, string[]> = {
        minimax: ['768P', '1080P'],
        fal: ['720p', '1080p', '1440p', '4K'],
        ark: ['720p', '1080p'],
        vidu: ['720p', '1080p', '2K']
    }

    return resolutionMap[provider as VideoProvider] || ['720p', '1080p']
}

/**
 * Check if resolution is supported (avoid unnecessary adaptation)
 *
 * @param provider - Model provider
 * @param resolution - Resolution
 * @returns Whether directly supported
 */
export function isResolutionSupported(provider: string, resolution: string): boolean {
    const supported = getSupportedResolutions(provider)
    return supported.includes(resolution)
}
