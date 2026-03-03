 import { logInfo as _ulogInfo, logWarn as _ulogWarn, logError as _ulogError } from '@/lib/logging/core'
/**
 * Multi-phase storyboard generation processor
 * Splits storyboard generation into 3 independent phases, each within Vercel time limits
 *
 * Retries once after each phase failure
 */

import { executeAiTextStep } from '@/lib/ai-runtime'
import { logAIAnalysis } from '@/lib/logging/semantic'
import { buildCharactersIntroduction } from '@/lib/constants'
import type { ContentLocale } from '@/lib/prompt-i18n'
import { getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'

// Phase types
export type StoryboardPhase = 1 | '2-cinematography' | '2-acting' | 3

type JsonRecord = Record<string, unknown>

export type ClipCharacterRef = string | { name?: string | null }

type CharacterAppearance = {
    changeReason?: string | null
    descriptions?: string | null
    selectedIndex?: number | null
    description?: string | null
}

export type CharacterAsset = {
    name: string
    appearances?: CharacterAppearance[]
}

export type LocationAsset = {
    name: string
    images?: Array<{
        isSelected?: boolean
        description?: string | null
    }>
}

type ClipAsset = {
    id?: string
    start?: string | number | null
    end?: string | number | null
    startText?: string | null
    endText?: string | null
    characters?: string | null
    location?: string | null
    content?: string | null
    screenplay?: string | null
}

type SessionAsset = {
    user: {
        id: string
        name: string
    }
}

type NovelPromotionAssetData = {
    analysisModel: string
    characters: CharacterAsset[]
    locations: LocationAsset[]
}

export type StoryboardPanel = JsonRecord & {
    panel_number?: number
    description?: string
    location?: string
    source_text?: string
    characters?: unknown
    srt_range?: unknown[]
    scene_type?: string
    shot_type?: string
    camera_move?: string
    video_prompt?: string
    duration?: number
    photographyPlan?: JsonRecord
    actingNotes?: unknown
}

export type PhotographyRule = JsonRecord & {
    panel_number?: number
    composition?: string
    lighting?: string
    color_palette?: string
    atmosphere?: string
    technical_notes?: string
}

export type ActingDirection = JsonRecord & {
    panel_number?: number
    characters?: unknown
}

function isJsonRecord(value: unknown): value is JsonRecord {
    return typeof value === 'object' && value !== null
}

function parseClipCharacters(raw: string | null | undefined): ClipCharacterRef[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        return Array.isArray(parsed) ? (parsed as ClipCharacterRef[]) : []
    } catch {
        return []
    }
}

function parseScreenplay(raw: string | null | undefined): unknown {
    if (!raw) return null
    try {
        return JSON.parse(raw)
    } catch {
        return null
    }
}

function parseDescriptions(raw: string | null | undefined): string[] {
    if (!raw) return []
    try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) return []
        return parsed.filter((item): item is string => typeof item === 'string')
    } catch {
        return []
    }
}

// Phase progress mapping
export const PHASE_PROGRESS: Record<string, { start: number, end: number, label: string, labelKey: string }> = {
    '1': { start: 10, end: 40, label: 'Planning storyboards', labelKey: 'phases.planning' },
    '2-cinematography': { start: 40, end: 55, label: 'Cinematography design', labelKey: 'phases.cinematography' },
    '2-acting': { start: 55, end: 70, label: 'Acting direction', labelKey: 'phases.acting' },
    '3': { start: 70, end: 100, label: 'Detail refinement', labelKey: 'phases.detail' }
}

// Intermediate result storage interface
export interface PhaseResult {
    clipId: string
    planPanels?: StoryboardPanel[]
    photographyRules?: PhotographyRule[]
    actingDirections?: ActingDirection[]  // Acting direction data
    finalPanels?: StoryboardPanel[]
}

// ========== Helper functions ==========

// Helper: extract character names from clipCharacters (supports mixed format)
function extractCharacterNames(clipCharacters: ClipCharacterRef[]): string[] {
    return clipCharacters.map(item => {
        if (typeof item === 'string') return item
        if (typeof item === 'object' && typeof item.name === 'string') return item.name
        return ''
    }).filter(Boolean)
}

/**
 * Check if character name matches reference by alias
 * Priority: 1. Exact full name  2. Alias match after splitting by '/'
 */
function characterNameMatches(characterName: string, referenceName: string): boolean {
    const charLower = characterName.toLowerCase().trim()
    const refLower = referenceName.toLowerCase().trim()
    if (charLower === refLower) return true
    const charAliases = charLower.split('/').map(s => s.trim()).filter(Boolean)
    const refAliases = refLower.split('/').map(s => s.trim()).filter(Boolean)
    return refAliases.some(refAlias => charAliases.includes(refAlias))
}

// Filter character appearance list by clip.characters
export function getFilteredAppearanceList(characters: CharacterAsset[], clipCharacters: ClipCharacterRef[]): string {
    if (clipCharacters.length === 0) return 'None'
    const charNames = extractCharacterNames(clipCharacters)
    return characters
        .filter((c) => charNames.some(name => characterNameMatches(c.name, name)))
        .map((c) => {
            const appearances = c.appearances || []
            if (appearances.length === 0) return `${c.name}: ["Initial appearance"]`
            const appearanceNames = appearances.map((app) => app.changeReason || 'Initial appearance')
            return `${c.name}: [${appearanceNames.map((n: string) => `"${n}"`).join(', ')}]`
        }).join('\n') || 'None'
}

// Filter character full description by clip.characters
export function getFilteredFullDescription(characters: CharacterAsset[], clipCharacters: ClipCharacterRef[]): string {
    if (clipCharacters.length === 0) return 'None'
    const charNames = extractCharacterNames(clipCharacters)
    return characters
        .filter((c) => charNames.some(name => characterNameMatches(c.name, name)))
        .map((c) => {
            const appearances = c.appearances || []
            if (appearances.length === 0) return `[${c.name}] No appearance description`

            return appearances.map((app) => {
                const appearanceName = app.changeReason || 'Initial appearance'
                const descriptions = parseDescriptions(app.descriptions)
                const selectedIndex = typeof app.selectedIndex === 'number' ? app.selectedIndex : 0
                const finalDesc = descriptions[selectedIndex] || app.description || 'No description'
                return `[${c.name} - ${appearanceName}] ${finalDesc}`
            }).join('\n')
        }).join('\n') || 'None'
}

// Filter location description by clip.location
export function getFilteredLocationsDescription(locations: LocationAsset[], clipLocation: string | null): string {
    if (!clipLocation) return 'None'
    const location = locations.find((l) => l.name.toLowerCase() === clipLocation.toLowerCase())
    if (!location) return 'None'
    const selectedImage = location.images?.find((img) => img.isSelected) || location.images?.[0]
    return selectedImage?.description || 'No description'
}

// Format clip identifier (supports SRT and Agent modes)
export function formatClipId(clip: ClipAsset): string {
    // SRT mode
    if (clip.start !== undefined && clip.start !== null) {
        return `${clip.start}-${clip.end}`
    }
    // Agent mode
    if (clip.startText && clip.endText) {
        return `${clip.startText.substring(0, 10)}...~...${clip.endText.substring(0, 10)}`
    }
    // Fallback
    return clip.id?.substring(0, 8) || 'unknown'
}

// Parse JSON response
function parseJsonResponse<T extends JsonRecord>(responseText: string, clipId: string, phase: number): T[] {
    let jsonText = responseText.trim()
    jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')

    const firstBracket = jsonText.indexOf('[')
    const lastBracket = jsonText.lastIndexOf(']')

    if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
        throw new Error(`Phase ${phase}: JSON format error clip ${clipId}`)
    }

    jsonText = jsonText.substring(firstBracket, lastBracket + 1)
    const result = JSON.parse(jsonText)

    if (!Array.isArray(result) || result.length === 0) {
        throw new Error(`Phase ${phase}: Empty response clip ${clipId}`)
    }

    const normalized = result.filter(isJsonRecord) as T[]
    if (normalized.length === 0) {
        throw new Error(`Phase ${phase}: Data structure error clip ${clipId}`)
    }

    return normalized
}

// ========== Phase 1: Basic storyboard planning ==========
export async function executePhase1(
    clip: ClipAsset,
    novelPromotionData: NovelPromotionAssetData,
    session: SessionAsset,
    projectId: string,
    projectName: string,
    locale: ContentLocale,
    taskId?: string
): Promise<PhaseResult> {
    const clipId = formatClipId(clip)
    void taskId
    _ulogInfo(`[Phase 1] Clip ${clipId}: Starting basic storyboard planning...`)

    // Read prompt template
    const planPromptTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_PLAN, locale)

    // Parse clip data
    const clipCharacters = parseClipCharacters(clip.characters)
    const clipLocation = clip.location || null

    // Build asset info
    const charactersLibName = novelPromotionData.characters.map((c) => c.name).join(', ') || 'None'
    const locationsLibName = novelPromotionData.locations.map((l) => l.name).join(', ') || 'None'
    const filteredAppearanceList = getFilteredAppearanceList(novelPromotionData.characters, clipCharacters)
    const filteredFullDescription = getFilteredFullDescription(novelPromotionData.characters, clipCharacters)
    const charactersIntroduction = buildCharactersIntroduction(novelPromotionData.characters)

    // Build clip JSON
    const clipJson = JSON.stringify({
        id: clip.id,
        content: clip.content,
        characters: clipCharacters,
        location: clipLocation
    }, null, 2)

    // Read screenplay
    const screenplay = parseScreenplay(clip.screenplay)
    if (clip.screenplay && !screenplay) {
        _ulogWarn(`[Phase 1] Clip ${clipId}: Screenplay JSON parse failed`)
    }

    // Build prompt
    let planPrompt = planPromptTemplate
        .replace('{characters_lib_name}', charactersLibName)
        .replace('{locations_lib_name}', locationsLibName)
        .replace('{characters_introduction}', charactersIntroduction)
        .replace('{characters_appearance_list}', filteredAppearanceList)
        .replace('{characters_full_description}', filteredFullDescription)
        .replace('{clip_json}', clipJson)

    if (screenplay) {
        planPrompt = planPrompt.replace('{clip_content}', `[Screenplay format]\n${JSON.stringify(screenplay, null, 2)}`)
    } else {
        planPrompt = planPrompt.replace('{clip_content}', clip.content || '')
    }

    // Log full prompt sent to AI
    logAIAnalysis(session.user.id, session.user.name, projectId, projectName, {
        action: 'STORYBOARD_PHASE1_PROMPT',
        input: { clipId, planPrompt },
        model: novelPromotionData.analysisModel
    })

    // Call AI (retry once on failure)
    let planPanels: StoryboardPanel[] = []

    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const planResult = await executeAiTextStep({
                userId: session.user.id,
                model: novelPromotionData.analysisModel,
                messages: [{ role: 'user', content: planPrompt }],
                reasoning: true,
                projectId,
                action: 'storyboard_phase1_plan',
                meta: {
                    stepId: 'storyboard_phase1_plan',
                    stepTitle: 'Storyboard planning',
                    stepIndex: 1,
                    stepTotal: 1,
                },
            })

            const planResponseText = planResult.text
            if (!planResponseText) {
                throw new Error(`Phase 1: No response clip ${clipId}`)
            }

            planPanels = parseJsonResponse<StoryboardPanel>(planResponseText, clipId, 1)

            // Count valid panels
            const validPanelCount = planPanels.filter(panel =>
                panel.description && panel.description !== 'None' && panel.location !== 'None'
            ).length

            _ulogInfo(`[Phase 1] Clip ${clipId}: ${planPanels.length} panels total, ${validPanelCount} valid`)

            if (validPanelCount === 0) {
                throw new Error(`Phase 1: All panels empty clip ${clipId}`)
            }

            // ========== Check source_text field, retry if missing ==========
            const missingSourceText = planPanels.some(panel => !panel.source_text)
            if (missingSourceText && attempt === 1) {
                _ulogWarn(`[Phase 1] Clip ${clipId}: Some panels missing source_text, retrying...`)
                continue
            }

            // Success, break loop
            break
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error)
            _ulogError(`[Phase 1] Clip ${clipId}: Attempt ${attempt} failed: ${message}`)
            if (attempt === 2) throw error
        }
    }

    // Log Phase 1 full output
    logAIAnalysis(session.user.id, session.user.name, projectId, projectName, {
        action: 'STORYBOARD_PHASE1_OUTPUT',
        output: {
            clipId,
            totalPanels: planPanels.length,
            phase1Result: planPanels
        },
        model: novelPromotionData.analysisModel
    })

    _ulogInfo(`[Phase 1] Clip ${clipId}: Generated ${planPanels.length} basic panels`)

    return { clipId, planPanels }
}

// ========== Phase 2: Photography rules generation ==========
export async function executePhase2(
    clip: ClipAsset,
    planPanels: StoryboardPanel[],
    novelPromotionData: NovelPromotionAssetData,
    session: SessionAsset,
    projectId: string,
    projectName: string,
    locale: ContentLocale,
    taskId?: string
): Promise<PhaseResult> {
    const clipId = formatClipId(clip)
    void taskId
    _ulogInfo(`[Phase 2] Clip ${clipId}: Starting photography rules generation...`)

    // Read prompt template
    const cinematographerPromptTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER, locale)

    // Parse clip data
    const clipCharacters = parseClipCharacters(clip.characters)
    const clipLocation = clip.location || null

    const filteredFullDescription = getFilteredFullDescription(novelPromotionData.characters, clipCharacters)
    const filteredLocationsDescription = getFilteredLocationsDescription(novelPromotionData.locations, clipLocation)

    // Build prompt
    const cinematographerPrompt = cinematographerPromptTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace('{panel_count}', planPanels.length.toString())
        .replace(/\{panel_count\}/g, planPanels.length.toString())
        .replace('{locations_description}', filteredLocationsDescription)
        .replace('{characters_info}', filteredFullDescription)

    let photographyRules: PhotographyRule[] = []

    // Retry once after failure
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const cinematographerResult = await executeAiTextStep({
                userId: session.user.id,
                model: novelPromotionData.analysisModel,
                messages: [{ role: 'user', content: cinematographerPrompt }],
                reasoning: true,
                projectId,
                action: 'storyboard_phase2_cinematography',
                meta: {
                    stepId: 'storyboard_phase2_cinematography',
                    stepTitle: 'Photography rules',
                    stepIndex: 1,
                    stepTotal: 1,
                },
            })

            const responseText = cinematographerResult.text
            if (!responseText) {
                throw new Error(`Phase 2: No response clip ${clipId}`)
            }

            photographyRules = parseJsonResponse<PhotographyRule>(responseText, clipId, 2)

            _ulogInfo(`[Phase 2] Clip ${clipId}: Successfully generated ${photographyRules.length} photography rules for shots`)

            // Log cinematography plan generation result
            logAIAnalysis(session.user.id, session.user.name, projectId, projectName, {
                action: 'CINEMATOGRAPHER_PLAN',
                output: {
                    clipId,
                    shotCount: planPanels.length,
                    photographyRulesCount: photographyRules.length,
                    photographyRules
                },
                model: novelPromotionData.analysisModel
            })

            // Success, break loop
            break
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e)
            _ulogError(`[Phase 2] Clip ${clipId}: Attempt ${attempt} failed: ${message}`)
            if (attempt === 2) throw e
        }
    }

    return { clipId, planPanels, photographyRules }
}

// ========== Phase 2-Acting: Acting direction generation ==========
export async function executePhase2Acting(
    clip: ClipAsset,
    planPanels: StoryboardPanel[],
    novelPromotionData: NovelPromotionAssetData,
    session: SessionAsset,
    projectId: string,
    projectName: string,
    locale: ContentLocale,
    taskId?: string
): Promise<PhaseResult> {
    const clipId = formatClipId(clip)
    void taskId
    _ulogInfo(`[Phase 2-Acting] ==========================================`)
    _ulogInfo(`[Phase 2-Acting] Clip ${clipId}: Starting acting direction generation...`)
    _ulogInfo(`[Phase 2-Acting] planPanels count: ${planPanels.length}`)
    _ulogInfo(`[Phase 2-Acting] projectId: ${projectId}, projectName: ${projectName}`)

    // Read prompt template
    const actingPromptTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_ACTING_DIRECTION, locale)

    // Parse clip data
    const clipCharacters = parseClipCharacters(clip.characters)

    const filteredFullDescription = getFilteredFullDescription(novelPromotionData.characters, clipCharacters)

    // Build prompt
    const actingPrompt = actingPromptTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace('{panel_count}', planPanels.length.toString())
        .replace(/\{panel_count\}/g, planPanels.length.toString())
        .replace('{characters_info}', filteredFullDescription)

    let actingDirections: ActingDirection[] = []

    // Retry once after failure
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const actingResult = await executeAiTextStep({
                userId: session.user.id,
                model: novelPromotionData.analysisModel,
                messages: [{ role: 'user', content: actingPrompt }],
                reasoning: true,
                projectId,
                action: 'storyboard_phase2_acting',
                meta: {
                    stepId: 'storyboard_phase2_acting',
                    stepTitle: 'Acting direction',
                    stepIndex: 1,
                    stepTotal: 1,
                },
            })

            const responseText = actingResult.text
            if (!responseText) {
                throw new Error(`Phase 2-Acting: No response clip ${clipId}`)
            }

            actingDirections = parseJsonResponse<ActingDirection>(responseText, clipId, 2)

            _ulogInfo(`[Phase 2-Acting] Clip ${clipId}: Successfully generated ${actingDirections.length} acting directions for shots`)

            // Log acting direction generation result
            logAIAnalysis(session.user.id, session.user.name, projectId, projectName, {
                action: 'ACTING_DIRECTION_PLAN',
                output: {
                    clipId,
                    shotCount: planPanels.length,
                    actingDirectionsCount: actingDirections.length,
                    actingDirections
                },
                model: novelPromotionData.analysisModel
            })

            // Success, break loop
            break
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e)
            _ulogError(`[Phase 2-Acting] Clip ${clipId}: Attempt ${attempt} failed: ${message}`)
            if (attempt === 2) throw e
        }
    }

    return { clipId, planPanels, actingDirections }
}

// ========== Phase 3: Add details and video_prompt ==========
export async function executePhase3(
    clip: ClipAsset,
    planPanels: StoryboardPanel[],
    photographyRules: PhotographyRule[],
    novelPromotionData: NovelPromotionAssetData,
    session: SessionAsset,
    projectId: string,
    projectName: string,
    locale: ContentLocale,
    taskId?: string
): Promise<PhaseResult> {
    const clipId = formatClipId(clip)
    void taskId
    _ulogInfo(`[Phase 3] Clip ${clipId}: Starting to add shot details...`)

    // Read prompt template
    const detailPromptTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL, locale)

    // Parse clip data
    const clipCharacters = parseClipCharacters(clip.characters)
    const clipLocation = clip.location || null

    const filteredFullDescription = getFilteredFullDescription(novelPromotionData.characters, clipCharacters)
    const filteredLocationsDescription = getFilteredLocationsDescription(novelPromotionData.locations, clipLocation)

    // Build prompt
    const detailPrompt = detailPromptTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace('{characters_age_gender}', filteredFullDescription)  // Use full description
        .replace('{locations_description}', filteredLocationsDescription)

    // Log full prompt sent to AI
    logAIAnalysis(session.user.id, session.user.name, projectId, projectName, {
        action: 'STORYBOARD_PHASE3_PROMPT',
        input: { clipId, fullPrompt: detailPrompt },
        model: novelPromotionData.analysisModel
    })

    void photographyRules
    let finalPanels: StoryboardPanel[] = []

    // Retry once after failure
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const detailResult = await executeAiTextStep({
                userId: session.user.id,
                model: novelPromotionData.analysisModel,
                messages: [{ role: 'user', content: detailPrompt }],
                reasoning: true,
                projectId,
                action: 'storyboard_phase3_detail',
                meta: {
                    stepId: 'storyboard_phase3_detail',
                    stepTitle: 'Shot refinement',
                    stepIndex: 1,
                    stepTotal: 1,
                },
            })

            const detailResponseText = detailResult.text
            if (!detailResponseText) {
                throw new Error(`Phase 3: No response clip ${clipId}`)
            }

            finalPanels = parseJsonResponse<StoryboardPanel>(detailResponseText, clipId, 3)

            // Record Phase 3 full output (before filtering)
            logAIAnalysis(session.user.id, session.user.name, projectId, projectName, {
                action: 'STORYBOARD_PHASE3_OUTPUT',
                output: {
                    clipId,
                    totalPanelCount: finalPanels.length,
                    phase3ResultBeforeFilter: finalPanels
                },
                model: novelPromotionData.analysisModel
            })

            // Filter out empty panels (supports both "None" in legacy data and current locale)
            const beforeFilterCount = finalPanels.length
            finalPanels = finalPanels.filter((panel) =>
                panel.description && panel.description !== 'None' &&
                panel.location !== 'None'
            )
            _ulogInfo(`[Phase 3] Clip ${clipId}: Filtered empty panels ${beforeFilterCount} -> ${finalPanels.length} valid panels`)

            if (finalPanels.length === 0) {
                throw new Error(`Phase 3: No valid panels after filtering clip ${clipId}`)
            }

            // Note: photographyRules merge is in route.ts, combined with parallel Phase 2 results

            // Log final output
            logAIAnalysis(session.user.id, session.user.name, projectId, projectName, {
                action: 'STORYBOARD_FINAL_OUTPUT',
                output: {
                    clipId,
                    beforeFilterCount,
                    afterFilterCount: finalPanels.length,
                    finalPanels
                },
                model: novelPromotionData.analysisModel
            })

            // Success, break loop
            break
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e)
            _ulogError(`[Phase 3] Clip ${clipId}: Attempt ${attempt} failed: ${message}`)
            if (attempt === 2) throw e
        }
    }

    _ulogInfo(`[Phase 3] Clip ${clipId}: Completed ${finalPanels.length} shot details`)

    return { clipId, finalPanels }
}
