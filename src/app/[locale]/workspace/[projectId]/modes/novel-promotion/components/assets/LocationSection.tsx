'use client'
import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

/**
 * LocationSection - location assets section
 * Location list and actions
 * 
 * V6.5: subscribe useProjectAssets
 */

import { Location } from '@/types/project'
import { useProjectAssets } from '@/lib/query/hooks/useProjectAssets'
import LocationCard from './LocationCard'
import { AppIcon } from '@/components/ui/icons'

interface LocationSectionProps {
    // V6.5: locations from subscription
    projectId: string
    activeTaskKeys: Set<string>
    onClearTaskKey: (key: string) => void
    // Callbacks
    onAddLocation: () => void
    onDeleteLocation: (locationId: string) => void
    onEditLocation: (location: Location) => void
    // V6.6: handleGenerateImage
    handleGenerateImage: (type: 'character' | 'location', id: string, appearanceId?: string) => void
    onSelectImage: (locationId: string, imageIndex: number | null) => void
    onConfirmSelection: (locationId: string) => void
    onRegenerateSingle: (locationId: string, imageIndex: number) => void
    onRegenerateGroup: (locationId: string) => void
    onUndo: (locationId: string) => void
    onImageClick: (imageUrl: string) => void
    onImageEdit: (locationId: string, imageIndex: number, locationName: string) => void
    onCopyFromGlobal: (locationId: string) => void  // Copy from hub
}

export default function LocationSection({
    // V6.5: locations from subscription
    projectId,
    activeTaskKeys,
    onClearTaskKey,
    onAddLocation,
    onDeleteLocation,
    onEditLocation,
    handleGenerateImage,
    onSelectImage,
    onConfirmSelection,
    onRegenerateSingle,
    onRegenerateGroup,
    onUndo,
    onImageClick,
    onImageEdit,
    onCopyFromGlobal
}: LocationSectionProps) {
    const t = useTranslations('assets')

    // V6.5: subscribe cache
    const { data: assets } = useProjectAssets(projectId)
    const locations: Location[] = assets?.locations ?? []

    return (
        <div className="glass-surface p-6">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)]">
                        <AppIcon name="imageLandscape" className="h-5 w-5" />
                    </span>
                    <h3 className="text-lg font-bold text-[var(--glass-text-primary)]">{t("stage.locationAssets")}</h3>
                    <span className="text-sm text-[var(--glass-text-tertiary)] bg-[var(--glass-bg-muted)]/50 px-2 py-1 rounded-lg">
                        {t("stage.locationCounts", { count: locations.length })}
                    </span>
                </div>
                <button
                    onClick={onAddLocation}
                    className="glass-btn-base glass-btn-primary flex items-center gap-2 px-4 py-2 font-medium"
                >
                    + {t("location.add")}
                </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-6 xl:grid-cols-6 gap-6">
                {locations.map(location => (
                    <LocationCard
                        key={location.id}
                        location={location}
                        onEdit={() => onEditLocation(location)}
                        onDelete={() => onDeleteLocation(location.id)}
                        onRegenerate={() => {
                            // Valid image count
                            const validImages = location.images?.filter(img => img.imageUrl) || []

_ulogInfo('[LocationSection] Regenerate check:', {
                                locationName: location.name,
                                images: location.images,
                                validImages,
                                validImageCount: validImages.length
                            })

                            // Single: regenerate one
                            if (validImages.length === 1) {
                                const imageIndex = validImages[0].imageIndex
_ulogInfo('[LocationSection] Single regenerate, imageIndex:', imageIndex)
                                onRegenerateSingle(location.id, imageIndex)
                            }
                            // Multi: regenerate group
                            else {
_ulogInfo('[LocationSection] Group regenerate')
                                onRegenerateGroup(location.id)
                            }
                        }}
                        onGenerate={() => handleGenerateImage('location', location.id)}
                        onUndo={() => onUndo(location.id)}
                        onImageClick={onImageClick}
                        onSelectImage={onSelectImage}
                        onImageEdit={(locId, imgIdx) => onImageEdit(locId, imgIdx, location.name)}
                        onCopyFromGlobal={() => onCopyFromGlobal(location.id)}
                        activeTaskKeys={activeTaskKeys}
                        onClearTaskKey={onClearTaskKey}
                        projectId={projectId}
                        onConfirmSelection={onConfirmSelection}
                    />
                ))}
            </div>
        </div>
    )
}
