/**
 * Unified Query Keys definition
 * All cache keys are centrally managed here to avoid inconsistency
 */
export const queryKeys = {
    // ============ Asset Hub ============
    globalAssets: {
        all: () => ['global-assets'] as const,
        characters: (folderId?: string | null) =>
            folderId ? ['global-assets', 'characters', folderId] as const : ['global-assets', 'characters'] as const,
        locations: (folderId?: string | null) =>
            folderId ? ['global-assets', 'locations', folderId] as const : ['global-assets', 'locations'] as const,
        voices: (folderId?: string | null) =>
            folderId ? ['global-assets', 'voices', folderId] as const : ['global-assets', 'voices'] as const,
        folders: () => ['global-assets', 'folders'] as const,
    },

    // ============ Project assets ============
    projectAssets: {
        all: (projectId: string) => ['project-assets', projectId] as const,
        characters: (projectId: string) => ['project-assets', projectId, 'characters'] as const,
        locations: (projectId: string) => ['project-assets', projectId, 'locations'] as const,
        detail: (projectId: string) => ['project-assets', projectId, 'detail'] as const,
    },

    // ============ Storyboard ============
    storyboards: {
        all: (episodeId: string) => ['storyboards', episodeId] as const,
        panels: (episodeId: string) => ['storyboards', episodeId, 'panels'] as const,
        groups: (episodeId: string) => ['storyboards', episodeId, 'groups'] as const,
    },

    // ============ Video generation ============
    videos: {
        all: (episodeId: string) => ['videos', episodeId] as const,
        panels: (episodeId: string) => ['videos', episodeId, 'panels'] as const,
    },

    // ============ Voice ============
    voiceLines: {
        all: (episodeId: string) => ['voice-lines', episodeId] as const,
        list: (episodeId: string) => ['voice-lines', episodeId, 'list'] as const,
        matched: (projectId: string, episodeId: string) =>
            ['voice-lines', projectId, episodeId, 'matched'] as const,
    },

    // ============ User models ============
    userModels: {
        all: () => ['user-models'] as const,
    },

    // ============ Task polling ============
    tasks: {
        all: (projectId: string) => ['tasks', projectId] as const,
        target: (projectId: string, targetType: string, targetId: string) =>
            ['tasks', projectId, targetType, targetId] as const,
        snapshot: (projectId: string, targetType: string, targetId: string, typeKey: string) =>
            ['tasks', projectId, targetType, targetId, 'snapshot', typeKey] as const,
        targetStatesAll: (projectId: string) =>
            ['task-target-states', projectId] as const,
        targetStates: (projectId: string, serializedTargets: string) =>
            ['task-target-states', projectId, serializedTargets] as const,
        targetStateOverlay: (projectId: string) =>
            ['task-target-states-overlay', projectId] as const,
        pending: (projectId: string, episodeId?: string) =>
            episodeId
                ? ['pending-tasks', projectId, episodeId] as const
                : ['pending-tasks', projectId] as const,
    },

    // ============ Project data ============
    project: {
        detail: (projectId: string) => ['project', projectId] as const,
        episodes: (projectId: string) => ['project', projectId, 'episodes'] as const,
        data: (projectId: string) => ['project', projectId, 'data'] as const,
    },

    // ============ Top-level convenience functions ============
    /**
     * Project base data
     */
    projectData: (projectId: string) => ['project-data', projectId] as const,

    /**
     * Episode detail data
     */
    episodeData: (projectId: string, episodeId: string) =>
        ['episode-data', projectId, episodeId] as const,
} as const

/**
 * Type export for type inference
 */
export type QueryKeys = typeof queryKeys
