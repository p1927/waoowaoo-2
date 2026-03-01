/**
 * Mutations module exports
 */

// ==================== Asset Hub (global assets) ====================
export {
    // Character related
    useGenerateCharacterImage,
    useModifyCharacterImage,
    useSelectCharacterImage,
    useUndoCharacterImage,
    useUploadCharacterImage,
    useDeleteCharacter,
    useDeleteCharacterAppearance,
    useUploadCharacterVoice,
    // Location related
    useGenerateLocationImage,
    useModifyLocationImage,
    useSelectLocationImage,
    useUndoLocationImage,
    useUploadLocationImage,
    useDeleteLocation,
    // Voice related
    useDeleteVoice,
    // Edit related
    useUpdateCharacterName,
    useUpdateLocationName,
    useUpdateCharacterAppearanceDescription,
    useUpdateLocationSummary,
    useAiModifyCharacterDescription,
    useAiModifyLocationDescription,
    useUploadAssetHubTempMedia,
    useAiDesignCharacter,
    useExtractAssetHubReferenceCharacterDescription,
    useCreateAssetHubCharacter,
} from './useAssetHubMutations'

// ==================== Project (project assets) ====================
export * from './useCharacterMutations'
export * from './useLocationMutations'
export * from './useStoryboardMutations'
export * from './useVideoMutations'
export * from './useVoiceMutations'
export * from './useProjectConfigMutations'
export * from './useEpisodeMutations'
