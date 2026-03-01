'use client'

import { useTranslations } from 'next-intl'
import PanelEditForm, { PanelEditData } from '../PanelEditForm'
import ImageSection from './ImageSection'
import PanelActionButtons from './PanelActionButtons'
import { StoryboardPanel } from './hooks/useStoryboardState'
import { GlassSurface } from '@/components/ui/primitives'
import { AppIcon } from '@/components/ui/icons'

interface PanelCandidateData {
  candidates: string[]
  selectedIndex: number
}

interface PanelCardProps {
  panel: StoryboardPanel
  panelData: PanelEditData
  imageUrl: string | null
  globalPanelNumber: number
  storyboardId: string
  videoRatio: string
  isSaving: boolean
  hasUnsavedChanges?: boolean
  saveErrorMessage?: string | null
  isDeleting: boolean
  isModifying: boolean
  isSubmittingPanelImageTask: boolean
  failedError: string | null
  candidateData: PanelCandidateData | null
  previousImageUrl?: string | null  // For undo
  onUpdate: (updates: Partial<PanelEditData>) => void
  onDelete: () => void
  onOpenCharacterPicker: () => void
  onOpenLocationPicker: () => void
  onRetrySave?: () => void
  onRemoveCharacter: (index: number) => void
  onRemoveLocation: () => void
  onRegeneratePanelImage: (panelId: string, count?: number, force?: boolean) => void
  onOpenEditModal: () => void
  onOpenAIDataModal: () => void
  onSelectCandidateIndex: (panelId: string, index: number) => void
  onConfirmCandidate: (panelId: string, imageUrl: string) => Promise<void>
  onCancelCandidate: (panelId: string) => void
  onClearError: () => void
  onUndo?: (panelId: string) => void  // Undo to previous
  onPreviewImage?: (url: string) => void  // Preview image
  onInsertAfter?: () => void  // Insert after this shot
  onVariant?: () => void  // Generate shot variant
  isInsertDisabled?: boolean  // Insert button disabled
}

export default function PanelCard({
  panel,
  panelData,
  imageUrl,
  globalPanelNumber,
  storyboardId,
  videoRatio,
  isSaving,
  hasUnsavedChanges = false,
  saveErrorMessage = null,
  isDeleting,
  isModifying,
  isSubmittingPanelImageTask,
  failedError,
  candidateData,
  previousImageUrl,
  onUpdate,
  onDelete,
  onOpenCharacterPicker,
  onOpenLocationPicker,
  onRetrySave,
  onRemoveCharacter,
  onRemoveLocation,
  onRegeneratePanelImage,
  onOpenEditModal,
  onOpenAIDataModal,
  onSelectCandidateIndex,
  onConfirmCandidate,
  onCancelCandidate,
  onClearError,
  onUndo,
  onPreviewImage,
  onInsertAfter,
  onVariant,
  isInsertDisabled
}: PanelCardProps) {
  const t = useTranslations('storyboard')
  return (
    <GlassSurface
      variant="elevated"
      padded={false}
      className="relative overflow-visible transition-all hover:shadow-[var(--glass-shadow-md)] group/card"
      data-storyboard-id={storyboardId}
    >
      {/* Delete button - top right */}
      {!isModifying && !isDeleting && (
        <button
          onClick={onDelete}
          className="absolute -top-2 -right-2 z-10 opacity-0 group-hover/card:opacity-100 transition-opacity bg-[var(--glass-tone-danger-fg)] hover:bg-[var(--glass-tone-danger-fg)] text-white w-5 h-5 rounded-full flex items-center justify-center text-xs shadow-md"
          title={t('panelActions.deleteShot')}
        >
          <AppIcon name="closeMd" className="h-3 w-3" />
        </button>
      )}

      {/* Shot image area with insert button */}
      <div className="relative">
        <ImageSection
          panelId={panel.id}
          imageUrl={imageUrl}
          globalPanelNumber={globalPanelNumber}
          shotType={panel.shot_type}
          videoRatio={videoRatio}
          isDeleting={isDeleting}
          isModifying={isModifying}
          isSubmittingPanelImageTask={isSubmittingPanelImageTask}
          failedError={failedError}
          candidateData={candidateData}
          previousImageUrl={previousImageUrl}
          onRegeneratePanelImage={onRegeneratePanelImage}
          onOpenEditModal={onOpenEditModal}
          onOpenAIDataModal={onOpenAIDataModal}
          onSelectCandidateIndex={onSelectCandidateIndex}
          onConfirmCandidate={onConfirmCandidate}
          onCancelCandidate={onCancelCandidate}
          onClearError={onClearError}
          onUndo={onUndo}
          onPreviewImage={onPreviewImage}
        />
        {/* Insert panel / shot variant button */}
        {(onInsertAfter || onVariant) && (
          <div className="absolute -right-[22px] top-1/2 -translate-y-1/2 z-50">
            <PanelActionButtons
              onInsertPanel={onInsertAfter || (() => { })}
              onVariant={onVariant || (() => { })}
              disabled={isInsertDisabled}
              hasImage={!!imageUrl}
            />
          </div>
        )}
      </div>

      {/* Panel info edit area */}
      <div className="p-3">
        <PanelEditForm
          panelData={panelData}
          isSaving={isSaving}
          saveStatus={hasUnsavedChanges ? 'error' : (isSaving ? 'saving' : 'idle')}
          saveErrorMessage={saveErrorMessage}
          onRetrySave={onRetrySave}
          onUpdate={onUpdate}
          onOpenCharacterPicker={onOpenCharacterPicker}
          onOpenLocationPicker={onOpenLocationPicker}
          onRemoveCharacter={onRemoveCharacter}
          onRemoveLocation={onRemoveLocation}
        />
      </div>
    </GlassSurface>
  )
}
