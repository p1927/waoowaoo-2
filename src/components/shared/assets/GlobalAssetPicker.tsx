'use client'
import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { MediaImageWithLoading } from '@/components/media/MediaImageWithLoading'
import { AppIcon } from '@/components/ui/icons'

interface GlobalAssetPickerProps {
    isOpen: boolean
    onClose: () => void
    onSelect: (globalAssetId: string) => void
    type: 'character' | 'location' | 'voice'
    loading?: boolean
}

interface GlobalCharacterAppearance {
    id: string
    imageUrl: string | null
    imageUrls: string[]
    selectedIndex: number | null
}

interface GlobalCharacter {
    id: string
    name: string
    folderId: string | null
    customVoiceUrl: string | null
    appearances: GlobalCharacterAppearance[]
}

interface GlobalLocationImage {
    id: string
    imageIndex: number
    imageUrl: string | null
    isSelected: boolean
}

interface GlobalLocation {
    id: string
    name: string
    summary: string | null
    folderId: string | null
    images: GlobalLocationImage[]
}

interface GlobalVoice {
    id: string
    name: string
    description: string | null
    folderId: string | null
    customVoiceUrl: string | null
    voiceId: string | null
    voiceType: string
    voicePrompt: string | null
    gender: string | null
    language: string
}

/** Get preview image URL from appearances */
function getCharacterPreview(char: GlobalCharacter): string | null {
    const first = char.appearances?.[0]
    if (!first) return null
    // Prefer image at selectedIndex
    if (first.selectedIndex != null && first.imageUrls?.[first.selectedIndex]) {
        return first.imageUrls[first.selectedIndex]
    }
    return first.imageUrl || first.imageUrls?.[0] || null
}

/** Get preview image URL from images */
function getLocationPreview(loc: GlobalLocation): string | null {
    const selected = loc.images?.find(img => img.isSelected)
    if (selected?.imageUrl) return selected.imageUrl
    return loc.images?.[0]?.imageUrl || null
}

// Inline SVG icon component
const XMarkIcon = ({ className }: { className?: string }) => (
    <AppIcon name="close" className={className} />
)

const MagnifyingGlassIcon = ({ className }: { className?: string }) => (
    <AppIcon name="search" className={className} />
)

const UserIcon = ({ className }: { className?: string }) => (
    <AppIcon name="userAlt" className={className} />
)

const PhotoIcon = ({ className }: { className?: string }) => (
    <AppIcon name="image" className={className} />
)

const CheckCircleIcon = ({ className }: { className?: string }) => (
    <AppIcon name="badgeCheck" className={className} />
)


const MicrophoneIcon = ({ className }: { className?: string }) => (
    <AppIcon name="mic" className={className} />
)

export default function GlobalAssetPicker({
    isOpen,
    onClose,
    onSelect,
    type,
    loading: externalLoading
}: GlobalAssetPickerProps) {
    const t = useTranslations('assetPicker')

    // Lightweight query: current type only, no task state
    const charactersQuery = useQuery({
        queryKey: ['global-assets', 'characters'],
        queryFn: async () => {
            const res = await fetch('/api/asset-hub/characters')
            if (!res.ok) throw new Error('Failed to fetch characters')
            const data = await res.json()
            return data.characters as GlobalCharacter[]
        },
        enabled: type === 'character',
    })
    const locationsQuery = useQuery({
        queryKey: ['global-assets', 'locations'],
        queryFn: async () => {
            const res = await fetch('/api/asset-hub/locations')
            if (!res.ok) throw new Error('Failed to fetch locations')
            const data = await res.json()
            return data.locations as GlobalLocation[]
        },
        enabled: type === 'location',
    })
    const voicesQuery = useQuery({
        queryKey: ['global-assets', 'voices'],
        queryFn: async () => {
            const res = await fetch('/api/asset-hub/voices')
            if (!res.ok) throw new Error('Failed to fetch voices')
            const data = await res.json()
            return data.voices as GlobalVoice[]
        },
        enabled: type === 'voice',
    })

    const characters = (charactersQuery.data || []) as GlobalCharacter[]
    const locations = (locationsQuery.data || []) as GlobalLocation[]
    const voices = (voicesQuery.data || []) as GlobalVoice[]
    const isLoading = type === 'character'
        ? charactersQuery.isFetching
        : type === 'location'
            ? locationsQuery.isFetching
            : voicesQuery.isFetching
    const loadingState = isLoading
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'process',
            resource: type === 'voice' ? 'audio' : 'image',
            hasOutput: false,
        })
        : null
    const copyingState = externalLoading
        ? resolveTaskPresentationState({
            phase: 'processing',
            intent: 'process',
            resource: type === 'voice' ? 'audio' : 'image',
            hasOutput: false,
        })
        : null
    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [searchQuery, setSearchQuery] = useState('')
    const [previewImage, setPreviewImage] = useState<string | null>(null)
    const [previewAudio, setPreviewAudio] = useState<string | null>(null)
    const [isPlayingAudio, setIsPlayingAudio] = useState(false)
    const audioRef = useRef<HTMLAudioElement | null>(null)

    // Stable refetch ref to avoid useEffect loop
    const refetchCharacters = charactersQuery.refetch
    const refetchLocations = locationsQuery.refetch
    const refetchVoices = voicesQuery.refetch

    // Helper to stop audio playback
    const stopAudio = () => {
        if (audioRef.current) {
            audioRef.current.pause()
            audioRef.current.currentTime = 0
            audioRef.current = null
        }
        setIsPlayingAudio(false)
        setPreviewAudio(null)
    }

    useEffect(() => {
        if (isOpen) {
            setSelectedId(null)
            setSearchQuery('')
            if (type === 'character') {
                refetchCharacters()
            } else if (type === 'location') {
                refetchLocations()
            } else {
                refetchVoices()
            }
        } else {
            // Stop playback when dialog closes
            stopAudio()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, type])

    const handleConfirm = () => {
        if (selectedId) {
            stopAudio()  // Stop audio on confirm copy
            onSelect(selectedId)
        }
    }

    const filteredCharacters = characters.filter(c =>
        c.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const filteredLocations = locations.filter(l =>
        l.name.toLowerCase().includes(searchQuery.toLowerCase())
    )

    const filteredVoices = voices.filter(v =>
        v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (v.description && v.description.toLowerCase().includes(searchQuery.toLowerCase()))
    )

    // Play/pause audio preview
    const handlePlayAudio = (audioUrl: string, e: React.MouseEvent) => {
        e.stopPropagation()

        // If clicking playing audio, pause
        if (previewAudio === audioUrl && isPlayingAudio) {
            stopAudio()
            return
        }

        // Stop previous playback
        stopAudio()

        // Start playing new audio
        setIsPlayingAudio(true)
        setPreviewAudio(audioUrl)
        const audio = new Audio(audioUrl)
        audioRef.current = audio
        audio.play()
        audio.onended = () => {
            setIsPlayingAudio(false)
            setPreviewAudio(null)
            audioRef.current = null
        }
        audio.onerror = () => {
            setIsPlayingAudio(false)
            setPreviewAudio(null)
            audioRef.current = null
        }
    }

    if (!isOpen) return null

    const items = type === 'character' ? filteredCharacters : type === 'location' ? filteredLocations : filteredVoices
    const hasNoAssets = type === 'character' ? characters.length === 0 : type === 'location' ? locations.length === 0 : voices.length === 0

    return (
        <div className="fixed inset-0 glass-overlay flex items-center justify-center z-50">
            <div className="glass-surface-modal w-[600px] max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--glass-stroke-base)]">
                    <h2 className="text-lg font-semibold text-[var(--glass-text-primary)]">
                        {type === 'character' ? t('selectCharacter') : type === 'location' ? t('selectLocation') : t('selectVoice')}
                    </h2>
                    <button onClick={onClose} className="glass-btn-base glass-btn-soft text-[var(--glass-text-tertiary)]">
                        <XMarkIcon className="w-5 h-5" />
                    </button>
                </div>

                {/* Search bar */}
                <div className="px-6 py-3 border-b border-[var(--glass-stroke-base)]">
                    <div className="relative">
                        <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-text-tertiary)]" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder={t('searchPlaceholder')}
                            className="glass-input-base w-full pl-9 pr-4 py-2 text-sm"
                        />
                    </div>
                </div>

                {/* Asset list */}
                <div className="flex-1 overflow-y-auto p-4">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-40">
                            <TaskStatusInline state={loadingState} />
                        </div>
                    ) : hasNoAssets ? (
                        <div className="flex flex-col items-center justify-center h-40 text-[var(--glass-text-tertiary)]">
                            {type === 'character' ? (
                                <UserIcon className="w-12 h-12 mb-2" />
                            ) : type === 'location' ? (
                                <PhotoIcon className="w-12 h-12 mb-2" />
                            ) : (
                                <MicrophoneIcon className="w-12 h-12 mb-2" />
                            )}
                            <p>{t('noAssets')}</p>
                            <p className="text-sm mt-1">{t('createInAssetHub')}</p>
                        </div>
                    ) : items.length === 0 ? (
                        <div className="flex items-center justify-center h-40 text-[var(--glass-text-tertiary)]">
                            <p>{t('noSearchResults')}</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-3">
                            {type === 'character' ? (
                                filteredCharacters.map((char) => {
                                    const charPreview = getCharacterPreview(char)
                                    return (
                                        <div
                                            key={char.id}
                                            onClick={() => setSelectedId(char.id)}
                                            className={`relative cursor-pointer rounded-xl border-2 p-2 transition-all hover:shadow-md ${selectedId === char.id
                                                ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)]'
                                                : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)]'
                                                }`}
                                        >
                                            {/* Selected marker */}
                                            {selectedId === char.id && (
                                                <CheckCircleIcon className="absolute -top-2 -right-2 w-6 h-6 text-[var(--glass-tone-info-fg)] bg-[var(--glass-bg-surface)] rounded-full" />
                                            )}

                                            {/* Preview image */}
                                            <div className="aspect-square rounded-lg overflow-hidden bg-[var(--glass-bg-muted)] mb-2 relative">
                                                {charPreview ? (
                                                    <MediaImageWithLoading
                                                        src={charPreview}
                                                        alt={char.name}
                                                        containerClassName="w-full h-full"
                                                        className="w-full h-full object-cover cursor-zoom-in"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setPreviewImage(charPreview)
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-[var(--glass-text-tertiary)]">
                                                        <UserIcon className="w-12 h-12" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Name */}
                                            <div className="text-center">
                                                <p className="font-medium text-sm text-[var(--glass-text-primary)] truncate">{char.name}</p>
                                                <p className="text-xs text-[var(--glass-text-secondary)] mt-1">
                                                    {char.appearances?.length || 0} {t('appearances')}
                                                    {char.customVoiceUrl && ' · Voice'}
                                                </p>
                                            </div>
                                        </div>
                                    )
                                })
                            ) : type === 'location' ? (
                                filteredLocations.map((loc) => {
                                    const locPreview = getLocationPreview(loc)
                                    return (
                                        <div
                                            key={loc.id}
                                            onClick={() => setSelectedId(loc.id)}
                                            className={`relative cursor-pointer rounded-xl border-2 p-2 transition-all hover:shadow-md ${selectedId === loc.id
                                                ? 'border-[var(--glass-stroke-focus)] bg-[var(--glass-tone-info-bg)]'
                                                : 'border-[var(--glass-stroke-base)] hover:border-[var(--glass-stroke-focus)]'
                                                }`}
                                        >
                                            {/* Selected marker */}
                                            {selectedId === loc.id && (
                                                <CheckCircleIcon className="absolute -top-2 -right-2 w-6 h-6 text-[var(--glass-tone-info-fg)] bg-[var(--glass-bg-surface)] rounded-full" />
                                            )}

                                            {/* Preview image */}
                                            <div className="aspect-video rounded-lg overflow-hidden bg-[var(--glass-bg-muted)] mb-2 relative">
                                                {locPreview ? (
                                                    <MediaImageWithLoading
                                                        src={locPreview}
                                                        alt={loc.name}
                                                        containerClassName="w-full h-full"
                                                        className="w-full h-full object-cover cursor-zoom-in"
                                                        onClick={(e) => {
                                                            e.stopPropagation()
                                                            setPreviewImage(locPreview)
                                                        }}
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center text-[var(--glass-text-tertiary)]">
                                                        <PhotoIcon className="w-12 h-12" />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Name */}
                                            <div className="text-center">
                                                <p className="font-medium text-sm text-[var(--glass-text-primary)] truncate">{loc.name}</p>
                                                <p className="text-xs text-[var(--glass-text-secondary)] mt-1">
                                                    {loc.images?.length || 0} {t('images')}
                                                </p>
                                            </div>
                                        </div>
                                    )
                                })
                            ) : (
                                // Voice list - match VoiceCard style
                                filteredVoices.map((voice) => {
                                    const genderIcon = voice.gender === 'male' ? 'M' : voice.gender === 'female' ? 'F' : ''
                                    const isVoicePlaying = previewAudio === voice.customVoiceUrl && isPlayingAudio
                                    return (
                                        <div
                                            key={voice.id}
                                            onClick={() => setSelectedId(voice.id)}
                                            className={`relative cursor-pointer glass-surface overflow-hidden transition-all hover:shadow-md ${selectedId === voice.id
                                                ? 'ring-2 ring-[var(--glass-stroke-focus)]'
                                                : 'hover:ring-2 hover:ring-[var(--glass-focus-ring-strong)]'
                                                }`}
                                        >
                                            {/* Selected marker */}
                                            {selectedId === voice.id && (
                                                <div className="absolute top-2 right-2 w-6 h-6 glass-chip glass-chip-info rounded-full flex items-center justify-center z-10 p-0">
                                                    <AppIcon name="checkSolid" className="w-4 h-4 text-white" />
                                                </div>
                                            )}

                                            {/* Voice icon area */}
                                            <div className="relative bg-[var(--glass-bg-muted)] p-6 flex items-center justify-center">
                                                <div className="w-16 h-16 rounded-full glass-surface-soft flex items-center justify-center">
                                                    <MicrophoneIcon className="w-8 h-8 text-[var(--glass-tone-info-fg)]" />
                                                </div>

                                                {/* Gender label */}
                                                {genderIcon && (
                                                    <div className="absolute top-2 left-2 glass-chip glass-chip-neutral text-xs px-2 py-0.5 rounded-full">
                                                        {genderIcon}
                                                    </div>
                                                )}

                                                {/* Preview button */}
                                                {voice.customVoiceUrl && (
                                                    <button
                                                        onClick={(e) => handlePlayAudio(voice.customVoiceUrl!, e)}
                                                        className={`absolute bottom-2 right-2 w-10 h-10 rounded-full glass-btn-base flex items-center justify-center transition-all ${isVoicePlaying
                                                            ? 'glass-btn-tone-info animate-pulse'
                                                            : 'glass-btn-secondary text-[var(--glass-tone-info-fg)]'
                                                            }`}
                                                    >
                                                        {isVoicePlaying ? (
                                                            <AppIcon name="pause" className="w-5 h-5" />
                                                        ) : (
                                                            <AppIcon name="play" className="w-5 h-5" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>

                                            {/* Info area */}
                                            <div className="p-3">
                                                <h3 className="font-medium text-[var(--glass-text-primary)] text-sm truncate">{voice.name}</h3>
                                                {voice.description && (
                                                    <p className="mt-1 text-xs text-[var(--glass-text-secondary)] line-clamp-2">{voice.description}</p>
                                                )}
                                                {voice.voicePrompt && !voice.description && (
                                                    <p className="mt-1 text-xs text-[var(--glass-text-tertiary)] line-clamp-2 italic">{voice.voicePrompt}</p>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })
                            )}
                        </div>
                    )}
                </div>

                {/* Footer buttons */}
                <div className="flex justify-end gap-3 px-6 py-4 border-t border-[var(--glass-stroke-base)] bg-[var(--glass-bg-surface-strong)]">
                    <button
                        onClick={onClose}
                        className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm"
                    >
                        {t('cancel')}
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={!selectedId || externalLoading}
                        className="glass-btn-base glass-btn-primary px-4 py-2 text-sm rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {externalLoading && <TaskStatusInline state={copyingState} className="text-white [&>span]:sr-only [&_svg]:text-white" />}
                        {t('confirmCopy')}
                    </button>
                </div>
            </div>

            {/* Image preview modal */}
            {
                previewImage && (
                    <ImagePreviewModal
                        imageUrl={previewImage}
                        onClose={() => setPreviewImage(null)}
                    />
                )
            }
        </div >
    )
}
