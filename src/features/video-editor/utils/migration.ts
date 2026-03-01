import { logWarn as _ulogWarn } from '@/lib/logging/core'
import { VideoEditorProject } from '../types/editor.types'

/**
 * Migrate project data from older schema to latest
 */
export function migrateProjectData(data: unknown): VideoEditorProject {
    const project = data as Record<string, unknown>

    // Check schema version
    const version = project.schemaVersion as string

    switch (version) {
        case '1.0':
            // Already latest, no migration
            return project as unknown as VideoEditorProject

        default:
            // Unknown or missing version, treat as 1.0
            _ulogWarn(`Unknown schema version: ${version}, treating as 1.0`)
            return {
                ...project,
                schemaVersion: '1.0'
            } as VideoEditorProject
    }
}

/**
 * Validate project data
 */
export function validateProjectData(data: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    const project = data as Record<string, unknown>

    if (!project.id) errors.push('Missing project id')
    if (!project.episodeId) errors.push('Missing episodeId')
    if (!project.schemaVersion) errors.push('Missing schemaVersion')
    if (!project.config) errors.push('Missing config')
    if (!Array.isArray(project.timeline)) errors.push('Invalid timeline')
    if (!Array.isArray(project.bgmTrack)) errors.push('Invalid bgmTrack')

    return {
        valid: errors.length === 0,
        errors
    }
}
