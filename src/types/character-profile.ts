/**
 * Character profile data structure
 * Used by two-phase character generation system
 */

export type RoleLevel = 'S' | 'A' | 'B' | 'C' | 'D'

export type CostumeTier = 1 | 2 | 3 | 4 | 5

export interface CharacterProfileData {
    /** Character importance tier */
    role_level: RoleLevel

    /** Character archetype (e.g. domineering CEO, schemer) */
    archetype: string

    /** Personality tags */
    personality_tags: string[]

    /** Era/period setting */
    era_period: string

    /** Social class */
    social_class: string

    /** Occupation (optional) */
    occupation?: string

    /** Costume extravagance (1-5) */
    costume_tier: CostumeTier

    /** Suggested colors */
    suggested_colors: string[]

    /** Primary identifier (required for S/A tier characters) */
    primary_identifier?: string

    /** Visual keywords */
    visual_keywords: string[]

    /** Gender */
    gender: string

    /** Age range description */
    age_range: string
}

/**
 * Parse character profile from JSON string
 */
export function parseProfileData(profileDataJson: string | null): CharacterProfileData | null {
    if (!profileDataJson) return null
    try {
        return JSON.parse(profileDataJson) as CharacterProfileData
    } catch {
        return null
    }
}

/**
 * Serialize character profile to JSON string
 */
export function stringifyProfileData(profileData: CharacterProfileData): string {
    return JSON.stringify(profileData)
}

/**
 * Validate character profile data completeness
 */
export function validateProfileData(data: unknown): data is CharacterProfileData {
    if (!data || typeof data !== 'object') return false
    const candidate = data as Partial<CharacterProfileData>
    return !!(
        typeof candidate.role_level === 'string' &&
        ['S', 'A', 'B', 'C', 'D'].includes(candidate.role_level) &&
        typeof candidate.archetype === 'string' &&
        Array.isArray(candidate.personality_tags) &&
        typeof candidate.era_period === 'string' &&
        typeof candidate.social_class === 'string' &&
        typeof candidate.costume_tier === 'number' &&
        candidate.costume_tier >= 1 &&
        candidate.costume_tier <= 5 &&
        Array.isArray(candidate.suggested_colors) &&
        Array.isArray(candidate.visual_keywords) &&
        typeof candidate.gender === 'string' &&
        typeof candidate.age_range === 'string'
    )
}
