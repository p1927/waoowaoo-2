'use client'

import { useTranslations } from 'next-intl'
/**
 * Assets confirmation stage - novel promotion
 * TTS generation and asset analysis
 * Refactor v2: character/location in useCharacterActions, useLocationActions;
 * batch in useBatchGeneration; TTS in useTTSGeneration; modals in useAssetModals;
 * profile in useProfileManagement; UI split into CharacterSection, LocationSection, AssetToolbar, AssetModals
 */

import { useState, useCallback, useMemo } from 'react'
import { Character, CharacterAppearance } from '@/types/project'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import {
  useGenerateProjectCharacterImage,
  useGenerateProjectLocationImage,
  useProjectAssets,
  useRefreshProjectAssets,
} from '@/lib/query/hooks'

// Hooks
import { useCharacterActions } from './assets/hooks/useCharacterActions'
import { useLocationActions } from './assets/hooks/useLocationActions'
import { useBatchGeneration } from './assets/hooks/useBatchGeneration'
import { useTTSGeneration } from './assets/hooks/useTTSGeneration'
import { useAssetModals } from './assets/hooks/useAssetModals'
import { useProfileManagement } from './assets/hooks/useProfileManagement'
import { useAssetsCopyFromHub } from './assets/hooks/useAssetsCopyFromHub'
import { useAssetsGlobalActions } from './assets/hooks/useAssetsGlobalActions'
import { useAssetsImageEdit } from './assets/hooks/useAssetsImageEdit'

// Components
import CharacterSection from './assets/CharacterSection'
import LocationSection from './assets/LocationSection'
import AssetToolbar from './assets/AssetToolbar'
import AssetsStageStatusOverlays from './assets/AssetsStageStatusOverlays'
import UnconfirmedProfilesSection from './assets/UnconfirmedProfilesSection'
import AssetsStageModals from './assets/AssetsStageModals'

interface AssetsStageProps {
  projectId: string
  isAnalyzingAssets: boolean
  focusCharacterId?: string | null
  focusCharacterRequestId?: number
  // Trigger global analyze via props (avoid URL param race)
  triggerGlobalAnalyze?: boolean
  onGlobalAnalyzeComplete?: () => void
}

export default function AssetsStage({
  projectId,
  isAnalyzingAssets,
  focusCharacterId = null,
  focusCharacterRequestId = 0,
  triggerGlobalAnalyze = false,
  onGlobalAnalyzeComplete
}: AssetsStageProps) {
  // V6.5: subscribe cache directly
  const { data: assets } = useProjectAssets(projectId)
  // useMemo for stable refs
  const characters = useMemo(() => assets?.characters ?? [], [assets?.characters])
  const locations = useMemo(() => assets?.locations ?? [], [assets?.locations])
  // React Query refetch
  const refreshAssets = useRefreshProjectAssets(projectId)
  const onRefresh = useCallback(() => { refreshAssets() }, [refreshAssets])

  // V6.6: mutation hooks instead of onGenerateImage
  const generateCharacterImage = useGenerateProjectCharacterImage(projectId)
  const generateLocationImage = useGenerateProjectLocationImage(projectId)

  // Internal image generation - mutation hooks, optimistic update
  const handleGenerateImage = useCallback(async (type: 'character' | 'location', id: string, appearanceId?: string) => {
    if (type === 'character' && appearanceId) {
      await generateCharacterImage.mutateAsync({ characterId: id, appearanceId })
    } else if (type === 'location') {
      // Location default imageIndex: 0
      await generateLocationImage.mutateAsync({ locationId: id, imageIndex: 0 })
    }
  }, [generateCharacterImage, generateLocationImage])

  const t = useTranslations('assets')
  // Total asset count
  const totalAppearances = characters.reduce((sum, char) => sum + (char.appearances?.length || 0), 0)
  const totalLocations = locations.length
  const totalAssets = totalAppearances + totalLocations

  // Local UI state
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'warning' | 'error' } | null>(null)

  // Get character appearances
  const getAppearances = (character: Character): CharacterAppearance[] => {
    return character.appearances || []
  }

  // Show toast
  const showToast = useCallback((message: string, type: 'success' | 'warning' | 'error' = 'success', duration = 3000) => {
    setToast({ message, type })
    setTimeout(() => setToast(null), duration)
  }, [])

  // === Extracted hooks ===

  // V6.5: hooks subscribe useProjectAssets internally

  // Batch generation
  const {
    isBatchSubmitting,
    batchProgress,
    activeTaskKeys,
    clearTransientTaskKey,
    handleGenerateAllImages,
    handleRegenerateAllImages
  } = useBatchGeneration({
    projectId,
    handleGenerateImage
  })

  const {
    isGlobalAnalyzing,
    globalAnalyzingState,
    handleGlobalAnalyze,
  } = useAssetsGlobalActions({
    projectId,
    triggerGlobalAnalyze,
    onGlobalAnalyzeComplete,
    onRefresh,
    showToast,
    t,
  })

  const {
    copyFromGlobalTarget,
    isGlobalCopyInFlight,
    handleCopyFromGlobal,
    handleCopyLocationFromGlobal,
    handleVoiceSelectFromHub,
    handleConfirmCopyFromGlobal,
    handleCloseCopyPicker,
  } = useAssetsCopyFromHub({
    projectId,
    onRefresh,
    showToast,
  })

  // Character actions
  const {
    handleDeleteCharacter,
    handleDeleteAppearance,
    handleSelectCharacterImage,
    handleConfirmSelection,
    handleRegenerateSingleCharacter,
    handleRegenerateCharacterGroup
  } = useCharacterActions({
    projectId,
    showToast
  })

  // Location actions
  const {
    handleDeleteLocation,
    handleSelectLocationImage,
    handleConfirmLocationSelection,
    handleRegenerateSingleLocation,
    handleRegenerateLocationGroup
  } = useLocationActions({
    projectId,
    showToast
  })

  // TTS / voice
  const {
    voiceDesignCharacter,
    handleVoiceChange,
    handleOpenVoiceDesign,
    handleVoiceDesignSave,
    handleCloseVoiceDesign
  } = useTTSGeneration({
    projectId
  })

  // Modal state
  const {
    editingAppearance,
    editingLocation,
    showAddCharacter,
    showAddLocation,
    imageEditModal,
    characterImageEditModal,
    setShowAddCharacter,
    setShowAddLocation,
    handleEditAppearance,
    handleEditLocation,
    handleOpenLocationImageEdit,
    handleOpenCharacterImageEdit,
    closeEditingAppearance,
    closeEditingLocation,
    closeAddCharacter,
    closeAddLocation,
    closeImageEditModal,
    closeCharacterImageEditModal
  } = useAssetModals({
    projectId
  })
  // Profile management
  const {
    unconfirmedCharacters,
    isConfirmingCharacter,
    deletingCharacterId,
    batchConfirming,
    editingProfile,
    handleEditProfile,
    handleConfirmProfile,
    handleBatchConfirm,
    handleDeleteProfile,
    setEditingProfile
  } = useProfileManagement({
    projectId,
    showToast
  })
  const batchConfirmingState = batchConfirming
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'modify',
      resource: 'image',
      hasOutput: false,
    })
    : null

  const {
    handleUndoCharacter,
    handleUndoLocation,
    handleLocationImageEdit,
    handleCharacterImageEdit,
    handleUpdateAppearanceDescription,
    handleUpdateLocationDescription,
  } = useAssetsImageEdit({
    projectId,
    t,
    showToast,
    onRefresh,
    editingAppearance,
    editingLocation,
    imageEditModal,
    characterImageEditModal,
    closeEditingAppearance,
    closeEditingLocation,
    closeImageEditModal,
    closeCharacterImageEditModal,
  })

  return (
    <div className="space-y-4">
      <AssetsStageStatusOverlays
        toast={toast}
        onCloseToast={() => setToast(null)}
        isGlobalAnalyzing={isGlobalAnalyzing}
        globalAnalyzingState={globalAnalyzingState}
        globalAnalyzingTitle={t('toolbar.globalAnalyzing')}
        globalAnalyzingHint={t('toolbar.globalAnalyzingHint')}
        globalAnalyzingTip={t('toolbar.globalAnalyzingTip')}
      />

      {/* Asset toolbar */}
      <AssetToolbar
        projectId={projectId}
        totalAssets={totalAssets}
        totalAppearances={totalAppearances}
        totalLocations={totalLocations}
        isBatchSubmitting={isBatchSubmitting}
        isAnalyzingAssets={isAnalyzingAssets}
        isGlobalAnalyzing={isGlobalAnalyzing}
        batchProgress={batchProgress}
        onGenerateAll={handleGenerateAllImages}
        onRegenerateAll={handleRegenerateAllImages}
        onGlobalAnalyze={handleGlobalAnalyze}
      />

      <UnconfirmedProfilesSection
        unconfirmedCharacters={unconfirmedCharacters}
        confirmTitle={t('stage.confirmProfiles')}
        confirmHint={t('stage.confirmHint')}
        confirmAllLabel={t('stage.confirmAll', { count: unconfirmedCharacters.length })}
        batchConfirming={batchConfirming}
        batchConfirmingState={batchConfirmingState}
        deletingCharacterId={deletingCharacterId}
        isConfirmingCharacter={isConfirmingCharacter}
        onBatchConfirm={handleBatchConfirm}
        onEditProfile={handleEditProfile}
        onConfirmProfile={handleConfirmProfile}
        onUseExistingProfile={handleCopyFromGlobal}
        onDeleteProfile={handleDeleteProfile}
      />

      {/* Character assets section */}
      <CharacterSection
        projectId={projectId}
        focusCharacterId={focusCharacterId}
        focusCharacterRequestId={focusCharacterRequestId}
        activeTaskKeys={activeTaskKeys}
        onClearTaskKey={clearTransientTaskKey}
        isAnalyzingAssets={isAnalyzingAssets}
        onAddCharacter={() => setShowAddCharacter(true)}
        onDeleteCharacter={handleDeleteCharacter}
        onDeleteAppearance={handleDeleteAppearance}
        onEditAppearance={handleEditAppearance}
        handleGenerateImage={handleGenerateImage}
        onSelectImage={handleSelectCharacterImage}
        onConfirmSelection={handleConfirmSelection}
        onRegenerateSingle={handleRegenerateSingleCharacter}
        onRegenerateGroup={handleRegenerateCharacterGroup}
        onUndo={handleUndoCharacter}
        onImageClick={setPreviewImage}
        onImageEdit={(charId, appIdx, imgIdx, name) => handleOpenCharacterImageEdit(charId, appIdx, imgIdx, name)}
        onVoiceChange={(characterId, customVoiceUrl) => handleVoiceChange(characterId, 'custom', characterId, customVoiceUrl)}
        onVoiceDesign={handleOpenVoiceDesign}
        onVoiceSelectFromHub={handleVoiceSelectFromHub}
        onCopyFromGlobal={handleCopyFromGlobal}
        getAppearances={getAppearances}
      />

      {/* Location assets section */}
      <LocationSection
        projectId={projectId}
        activeTaskKeys={activeTaskKeys}
        onClearTaskKey={clearTransientTaskKey}
        onAddLocation={() => setShowAddLocation(true)}
        onDeleteLocation={handleDeleteLocation}
        onEditLocation={handleEditLocation}
        handleGenerateImage={handleGenerateImage}
        onSelectImage={handleSelectLocationImage}
        onConfirmSelection={handleConfirmLocationSelection}
        onRegenerateSingle={handleRegenerateSingleLocation}
        onRegenerateGroup={handleRegenerateLocationGroup}
        onUndo={handleUndoLocation}
        onImageClick={setPreviewImage}
        onImageEdit={(locId, imgIdx) => handleOpenLocationImageEdit(locId, imgIdx)}
        onCopyFromGlobal={handleCopyLocationFromGlobal}
      />

      <AssetsStageModals
        projectId={projectId}
        onRefresh={onRefresh}
        onClosePreview={() => setPreviewImage(null)}
        handleGenerateImage={handleGenerateImage}
        handleUpdateAppearanceDescription={handleUpdateAppearanceDescription}
        handleUpdateLocationDescription={handleUpdateLocationDescription}
        handleLocationImageEdit={handleLocationImageEdit}
        handleCharacterImageEdit={handleCharacterImageEdit}
        handleCloseVoiceDesign={handleCloseVoiceDesign}
        handleVoiceDesignSave={handleVoiceDesignSave}
        handleCloseCopyPicker={handleCloseCopyPicker}
        handleConfirmCopyFromGlobal={handleConfirmCopyFromGlobal}
        handleConfirmProfile={handleConfirmProfile}
        closeEditingAppearance={closeEditingAppearance}
        closeEditingLocation={closeEditingLocation}
        closeAddCharacter={closeAddCharacter}
        closeAddLocation={closeAddLocation}
        closeImageEditModal={closeImageEditModal}
        closeCharacterImageEditModal={closeCharacterImageEditModal}
        isConfirmingCharacter={isConfirmingCharacter}
        setEditingProfile={setEditingProfile}
        previewImage={previewImage}
        imageEditModal={imageEditModal}
        characterImageEditModal={characterImageEditModal}
        editingAppearance={editingAppearance}
        editingLocation={editingLocation}
        showAddCharacter={showAddCharacter}
        showAddLocation={showAddLocation}
        voiceDesignCharacter={voiceDesignCharacter}
        editingProfile={editingProfile}
        copyFromGlobalTarget={copyFromGlobalTarget}
        isGlobalCopyInFlight={isGlobalCopyInFlight}
      />
    </div>
  )
}
