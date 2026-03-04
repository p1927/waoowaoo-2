'use client'
import { logInfo as _ulogInfo } from '@/lib/logging/core'

import { useTranslations } from 'next-intl'
/**
 * Character card - multi-image + voice
 * Layout: name+description top, three images below (each image has edit and regenerate)
 */

import { useState, useRef } from 'react'
import { Character, CharacterAppearance } from '@/types/project'
import { shouldShowError } from '@/lib/error-utils'
import VoiceSettings from './VoiceSettings'
import { useUploadProjectCharacterImage } from '@/lib/query/mutations'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import CharacterCardHeader from './character-card/CharacterCardHeader'
import CharacterCardGallery from './character-card/CharacterCardGallery'
import CharacterCardActions from './character-card/CharacterCardActions'
import { AppIcon } from '@/components/ui/icons'

interface CharacterCardProps {
  character: Character
  appearance: CharacterAppearance
  onEdit: () => void
  onDelete: () => void
  onDeleteAppearance?: () => void  // Delete single appearance
  onRegenerate: () => void
  onGenerate: () => void
  onUndo?: () => void  // Undo to previous
  onImageClick: (imageUrl: string) => void
  showDeleteButton: boolean
  appearanceCount?: number  // Number of appearances
  onSelectImage?: (characterId: string, appearanceId: string, imageIndex: number | null) => void
  activeTaskKeys?: Set<string>
  onClearTaskKey?: (key: string) => void
  onImageEdit?: (characterId: string, appearanceId: string, imageIndex: number) => void
  isPrimaryAppearance?: boolean
  primaryAppearanceSelected?: boolean
  projectId: string
  onConfirmSelection?: (characterId: string, appearanceId: string) => void  // Confirm selection
  // Voice
  onVoiceChange?: (characterId: string, customVoiceUrl?: string) => void
  onVoiceDesign?: (characterId: string, characterName: string) => void  // AI voice design
  onVoiceSelectFromHub?: (characterId: string) => void  // Pick voice from asset hub
}

export default function CharacterCard({
  character,
  appearance,
  onEdit,
  onDelete,
  onDeleteAppearance,
  onRegenerate,
  onGenerate,
  onUndo,
  onImageClick,
  showDeleteButton,
  appearanceCount = 1,
  onSelectImage,
  activeTaskKeys = new Set(),
  onImageEdit,
  isPrimaryAppearance = false,
  primaryAppearanceSelected = false,
  projectId,
  onConfirmSelection,
  onVoiceChange,
  onVoiceDesign,
  onVoiceSelectFromHub
}: CharacterCardProps) {
  // Use mutation
  const uploadImage = useUploadProjectCharacterImage(projectId)
  const t = useTranslations('assets')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pendingUploadIndex, setPendingUploadIndex] = useState<number | undefined>(undefined)
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [isConfirmingSelection, setIsConfirmingSelection] = useState(false)

  // Handle delete click
  const handleDeleteClick = () => {
    if (appearanceCount <= 1) {
      // Single appearance: delete character
      onDelete()
    } else {
      // Multiple: show menu
      setShowDeleteMenu(!showDeleteMenu)
    }
  }

  // Trigger file select
  const triggerUpload = (imageIndex?: number) => {
    setPendingUploadIndex(imageIndex)
    fileInputRef.current?.click()
  }

  // Handle image upload
  const handleUpload = () => {
    const file = fileInputRef.current?.files?.[0]
    if (!file) return

    const uploadIndex = pendingUploadIndex

    uploadImage.mutate(
      {
        file,
        characterId: character.id,
        appearanceId: appearance.id,
        imageIndex: uploadIndex,
        labelText: `${character.name} - ${appearance.changeReason}`
      },
      {
        onSuccess: () => {
          alert(t('image.uploadSuccess'))
        },
        onError: (error) => {
          if (shouldShowError(error)) {
            alert(t('image.uploadFailed') + ': ' + error.message)
          }
        },
        onSettled: () => {
          setPendingUploadIndex(undefined)
          if (fileInputRef.current) {
            fileInputRef.current.value = ''
          }
        }
      }
    )
  }

  // Voice handled by VoiceSettings

  // Get image array (no JSON parse)
  const rawImageUrls = appearance.imageUrls || []
  const imageUrlsWithIndex = rawImageUrls
    .map((url, idx) => ({ url, originalIndex: idx }))
    .filter((item) => !!item.url) as { url: string; originalIndex: number }[]

  const hasMultipleImages = imageUrlsWithIndex.length > 1
  const selectedIndex = appearance.selectedIndex ?? null

  // Image URL priority: imageUrl > imageUrls[selectedIndex] > imageUrls[0]
  // So edited image displays correctly
  const currentImageUrl = appearance.imageUrl ||
    (selectedIndex !== null ? rawImageUrls[selectedIndex] : null) ||
    imageUrlsWithIndex[0]?.url

  // Debug log
  if (!currentImageUrl) {
_ulogInfo(`[CharacterCard] ${character.name}-${appearance.changeReason}:`, {
      imageUrl: appearance.imageUrl,
      imageUrls: appearance.imageUrls,
      rawImageUrls,
      imageUrlsWithIndex,
      currentImageUrl
    })
  }

  const showSelectionMode = hasMultipleImages

  const isImageTaskRunning = (imageIndex: number) => {
    return activeTaskKeys.has(`character-${character.id}-${appearance.appearanceIndex}-${imageIndex}`)
  }

  const isGroupTaskRunning = activeTaskKeys.has(`character-${character.id}-${appearance.appearanceIndex}-group`)

  const isAnyTaskRunning = isGroupTaskRunning || Array.from(activeTaskKeys).some(key =>
    key.startsWith(`character-${character.id}-${appearance.appearanceIndex}`)
  )
  const appearanceTaskRunning = !!appearance.imageTaskRunning
  const appearanceTaskPresentation = appearanceTaskRunning
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: currentImageUrl ? 'regenerate' : 'generate',
      resource: 'image',
      hasOutput: !!currentImageUrl,
    })
    : null
  const fallbackRunningPresentation = isAnyTaskRunning
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'regenerate',
      resource: 'image',
      hasOutput: !!currentImageUrl,
    })
    : null
  const displayTaskPresentation = appearanceTaskPresentation || fallbackRunningPresentation
  const confirmSelectionState = isConfirmingSelection
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'process',
      resource: 'image',
      hasOutput: !!currentImageUrl,
    })
    : null
  const uploadPendingState = uploadImage.isPending
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'process',
      resource: 'image',
      hasOutput: !!currentImageUrl,
    })
    : null
  const isAppearanceTaskRunning =
    appearanceTaskRunning ||
    isAnyTaskRunning

  // State from task + entity, not editingItems

  // Selection: name+description top, three images below
  if (showSelectionMode) {
    const selectionActions = (
      <>
        <button
          onClick={onRegenerate}
          disabled={isAppearanceTaskRunning || isAnyTaskRunning || uploadImage.isPending}
          className="w-6 h-6 rounded hover:bg-[var(--glass-tone-info-bg)] flex items-center justify-center transition-colors disabled:opacity-50"
          title={t('image.regenerateGroup')}
        >
          {isGroupTaskRunning ? (
            <TaskStatusInline state={displayTaskPresentation} className="[&_span]:sr-only [&_svg]:text-[var(--glass-tone-info-fg)]" />
          ) : (
            <AppIcon name="refresh" className="w-4 h-4 text-[var(--glass-tone-info-fg)]" />
          )}
        </button>
        {onUndo && (appearance.previousImageUrl || appearance.previousImageUrls.length > 0) && (
          <button
            onClick={onUndo}
            disabled={isAppearanceTaskRunning || isAnyTaskRunning}
            className="w-6 h-6 rounded hover:bg-[var(--glass-tone-warning-bg)] flex items-center justify-center transition-colors disabled:opacity-50"
            title={t('image.undo')}
          >
            <AppIcon name="undo" className="w-4 h-4 text-[var(--glass-tone-warning-fg)]" />
          </button>
        )}
        {showDeleteButton && (
          <button
            onClick={onDelete}
            className="w-6 h-6 rounded hover:bg-[var(--glass-tone-danger-bg)] flex items-center justify-center transition-colors"
            title={t('character.delete')}
          >
            <AppIcon name="trash" className="w-4 h-4 text-[var(--glass-tone-danger-fg)]" />
          </button>
        )}
      </>
    )

    const selectionVoiceSettings = (
      <VoiceSettings
        characterId={character.id}
        characterName={character.name}
        voiceId={character.voiceId}
        customVoiceUrl={character.customVoiceUrl}
        projectId={projectId}
        onVoiceChange={onVoiceChange}
        onVoiceDesign={onVoiceDesign}
        onSelectFromHub={onVoiceSelectFromHub}
      />
    )

    return (
      <div className="col-span-3 bg-[var(--glass-bg-surface)] rounded-lg border-2 border-[var(--glass-stroke-base)] p-4 shadow-sm transition-all">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={() => handleUpload()}
          className="hidden"
        />

        <CharacterCardHeader
          mode="selection"
          characterName={character.name}
          changeReason={appearance.changeReason}
          isPrimaryAppearance={isPrimaryAppearance}
          selectedIndex={selectedIndex}
          actions={selectionActions}
        />

        <CharacterCardGallery
          mode="selection"
          characterId={character.id}
          appearanceId={appearance.id}
          characterName={character.name}
          imageUrlsWithIndex={imageUrlsWithIndex}
          selectedIndex={selectedIndex}
          isGroupTaskRunning={isGroupTaskRunning}
          isImageTaskRunning={isImageTaskRunning}
          displayTaskPresentation={displayTaskPresentation}
          onImageClick={onImageClick}
          onSelectImage={onSelectImage}
        />

        <CharacterCardActions
          mode="selection"
          selectedIndex={selectedIndex}
          isConfirmingSelection={isConfirmingSelection}
          confirmSelectionState={confirmSelectionState}
          onConfirmSelection={() => {
            setIsConfirmingSelection(true)
            onConfirmSelection?.(character.id, appearance.id)
          }}
          isPrimaryAppearance={isPrimaryAppearance}
          voiceSettings={selectionVoiceSettings}
        />
      </div>
    )
  }

  // Single image or selected mode
  const overlayActions = (
    <>
      {!isAppearanceTaskRunning && !isAnyTaskRunning && (
        <button
          onClick={() => triggerUpload(selectedIndex !== null ? selectedIndex : 0)}
          disabled={uploadImage.isPending || isAppearanceTaskRunning || isAnyTaskRunning}
          className="w-7 h-7 rounded-full bg-[var(--glass-bg-surface-strong)] hover:bg-[var(--glass-tone-success-fg)] hover:text-white flex items-center justify-center transition-all shadow-sm disabled:opacity-50"
          title={currentImageUrl ? t('image.uploadReplace') : t('image.upload')}
        >
          {uploadImage.isPending ? (
            <TaskStatusInline state={uploadPendingState} className="[&_span]:sr-only [&_svg]:text-current" />
          ) : (
            <AppIcon name="upload" className="w-4 h-4 text-[var(--glass-tone-success-fg)]" />
          )}
        </button>
      )}
      {!isAppearanceTaskRunning && !isAnyTaskRunning && currentImageUrl && onImageEdit && (
        <button
          onClick={() => onImageEdit(character.id, appearance.id, selectedIndex !== null ? selectedIndex : 0)}
          className="w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm"
          style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}
          title={t('image.edit')}
        >
          <AppIcon name="edit" className="w-4 h-4 text-white" />
        </button>
      )}
      <button
        onClick={onRegenerate}
        disabled={uploadImage.isPending || isAppearanceTaskRunning}
        className={`w-7 h-7 rounded-full flex items-center justify-center transition-all shadow-sm active:scale-90 ${(isAppearanceTaskRunning || isAnyTaskRunning)
          ? 'bg-[var(--glass-tone-success-fg)] hover:bg-[var(--glass-tone-success-fg)]'
          : 'bg-[var(--glass-bg-surface-strong)] hover:bg-[var(--glass-bg-surface)]'
          }`}
        title={(isAppearanceTaskRunning || isAnyTaskRunning) ? t('image.regenerateStuck') : t('location.regenerateImage')}
      >
        {isGroupTaskRunning ? (
          <TaskStatusInline state={displayTaskPresentation} className="[&_span]:sr-only [&_svg]:text-white" />
        ) : (
          <AppIcon name="refresh" className={`w-4 h-4 ${(isAppearanceTaskRunning || isAnyTaskRunning) ? 'text-white' : 'text-[var(--glass-text-secondary)]'}`} />
        )}
      </button>
      {!isAppearanceTaskRunning && !isAnyTaskRunning && currentImageUrl && onUndo && (appearance.previousImageUrl || appearance.previousImageUrls.length > 0) && (
        <button
          onClick={onUndo}
          disabled={isAppearanceTaskRunning || isAnyTaskRunning}
          className="w-7 h-7 rounded-full bg-[var(--glass-bg-surface-strong)] hover:bg-[var(--glass-tone-warning-fg)] hover:text-white flex items-center justify-center transition-all shadow-sm disabled:opacity-50"
          title={t('image.undo')}
        >
          <AppIcon name="undo" className="w-4 h-4 text-[var(--glass-tone-warning-fg)] hover:text-white" />
        </button>
      )}
    </>
  )

  const compactHeaderActions = (
    <>
      <button
        onClick={onEdit}
        className="flex-shrink-0 w-5 h-5 rounded hover:bg-[var(--glass-bg-muted)] flex items-center justify-center transition-colors"
        title={t('video.panelCard.editPrompt')}
      >
        <AppIcon name="edit" className="w-3.5 h-3.5 text-[var(--glass-text-secondary)]" />
      </button>
      {showDeleteButton && (
        <div className="relative">
          <button
            onClick={handleDeleteClick}
            className="flex-shrink-0 w-5 h-5 rounded hover:bg-[var(--glass-tone-danger-bg)] flex items-center justify-center transition-colors"
            title={appearanceCount <= 1 ? t('character.delete') : t('character.deleteOptions')}
          >
            <AppIcon name="trash" className="w-3.5 h-3.5 text-[var(--glass-tone-danger-fg)]" />
          </button>

          {showDeleteMenu && appearanceCount > 1 && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setShowDeleteMenu(false)}
              />
              <div className="absolute right-0 top-full mt-1 z-20 bg-[var(--glass-bg-surface)] border border-[var(--glass-stroke-base)] rounded-lg shadow-lg py-1 min-w-[100px]">
                <button
                  onClick={() => {
                    setShowDeleteMenu(false)
                    onDeleteAppearance?.()
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-muted)] whitespace-nowrap"
                >
                  {t('image.deleteThis')}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteMenu(false)
                    onDelete()
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs text-[var(--glass-tone-danger-fg)] hover:bg-[var(--glass-tone-danger-bg)] whitespace-nowrap"
                >
                  {t('character.deleteWhole')}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  )

  const compactVoiceSettings = (
    <VoiceSettings
      characterId={character.id}
      characterName={character.name}
      voiceId={character.voiceId}
      customVoiceUrl={character.customVoiceUrl}
      projectId={projectId}
      onVoiceChange={onVoiceChange}
      onVoiceDesign={onVoiceDesign}
      onSelectFromHub={onVoiceSelectFromHub}
      compact={true}
    />
  )

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={() => handleUpload()}
        className="hidden"
      />
      <div className="relative">
        <CharacterCardGallery
          mode="single"
          characterName={character.name}
          changeReason={appearance.changeReason}
          currentImageUrl={currentImageUrl}
          selectedIndex={selectedIndex}
          hasMultipleImages={hasMultipleImages}
          isAppearanceTaskRunning={isAppearanceTaskRunning || isGroupTaskRunning}
          displayTaskPresentation={displayTaskPresentation}
          appearanceErrorMessage={appearance.lastError?.message || appearance.imageErrorMessage}
          onImageClick={onImageClick}
          overlayActions={overlayActions}
        />
      </div>

      <CharacterCardHeader
        mode="compact"
        characterName={character.name}
        changeReason={appearance.changeReason}
        actions={compactHeaderActions}
      />

      <CharacterCardActions
        mode="compact"
        isPrimaryAppearance={isPrimaryAppearance}
        primaryAppearanceSelected={primaryAppearanceSelected}
        currentImageUrl={currentImageUrl}
        isAppearanceTaskRunning={isAppearanceTaskRunning}
        isAnyTaskRunning={isAnyTaskRunning}
        hasDescription={!!appearance.description}
        onGenerate={onGenerate}
        voiceSettings={compactVoiceSettings}
      />
    </div>
  )
}
