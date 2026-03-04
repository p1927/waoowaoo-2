'use client'

/**
 * VoiceSettings - from CharacterCard
 * Upload custom audio and AI voice design
 */

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { shouldShowError } from '@/lib/error-utils'
import { useUploadProjectCharacterVoice, useUpdateProjectCharacterVoiceSettings } from '@/lib/query/mutations'
import { AppIcon } from '@/components/ui/icons'

// Common Google TTS voices
const GOOGLE_TTS_VOICES = [
    { id: 'en-US-Neural2-F', name: 'English US (Female)', language: 'en-US', gender: 'female' },
    { id: 'en-US-Neural2-M', name: 'English US (Male)', language: 'en-US', gender: 'male' },
    { id: 'en-GB-Neural2-A', name: 'English UK (Neutral)', language: 'en-GB', gender: 'neutral' },
    { id: 'en-GB-Neural2-B', name: 'English UK (Male)', language: 'en-GB', gender: 'male' },
    { id: 'en-IN-Neural2-A', name: 'English India (Female)', language: 'en-IN', gender: 'female' },
    { id: 'en-IN-Neural2-B', name: 'English India (Male)', language: 'en-IN', gender: 'male' },
    { id: 'en-AU-Neural2-A', name: 'English Australia (Female)', language: 'en-AU', gender: 'female' },
    { id: 'en-AU-Neural2-B', name: 'English Australia (Male)', language: 'en-AU', gender: 'male' },
]

interface VoiceSettingsProps {
    characterId: string
    characterName: string
    voiceId?: string | null
    customVoiceUrl: string | null | undefined
    projectId: string
    onVoiceChange?: (characterId: string, customVoiceUrl?: string) => void
    onVoiceDesign?: (characterId: string, characterName: string) => void
    onSelectFromHub?: (characterId: string) => void  // Pick from hub
    compact?: boolean  // Compact (single-image card)
}

function getErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) return error.message
    if (typeof error === 'object' && error !== null) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string') return message
    }
    return fallback
}

export default function VoiceSettings({
    characterId,
    characterName,
    voiceId,
    customVoiceUrl,
    projectId,
    onVoiceChange,
    onVoiceDesign,
    onSelectFromHub,
    compact = false
}: VoiceSettingsProps) {
    const t = useTranslations('assets')
    // Use mutations
    const uploadVoice = useUploadProjectCharacterVoice(projectId)
    const updateVoiceSettings = useUpdateProjectCharacterVoiceSettings(projectId)
    const voiceFileInputRef = useRef<HTMLInputElement>(null)
    const audioRef = useRef<HTMLAudioElement | null>(null)
    const [isPreviewingVoice, setIsPreviewingVoice] = useState(false)
    const [showVoiceSelector, setShowVoiceSelector] = useState(false)

    const hasCustomVoice = !!customVoiceUrl
    const hasPredefinedVoice = !!voiceId && !customVoiceUrl
    const hasAnyVoice = hasCustomVoice || hasPredefinedVoice
    const selectedVoice = GOOGLE_TTS_VOICES.find(v => v.id === voiceId)

    // Preview voice (play/pause custom audio)
    const handlePreviewVoice = async () => {
        if (!customVoiceUrl) return

        // If playing, click to pause
        if (isPreviewingVoice && audioRef.current) {
            audioRef.current.pause()
            setIsPreviewingVoice(false)
            return
        }

        try {
            if (audioRef.current) {
                audioRef.current.pause()
            }
            const audio = new Audio(customVoiceUrl)
            audioRef.current = audio
            audio.play()
            audio.onended = () => setIsPreviewingVoice(false)
            audio.onerror = () => setIsPreviewingVoice(false)
            setIsPreviewingVoice(true)
        } catch (error: unknown) {
            if (shouldShowError(error)) {
                alert(t('tts.previewFailed', { error: getErrorMessage(error, t('common.unknownError')) }))
            }
            setIsPreviewingVoice(false)
        }
    }

    // Upload custom audio
    const handleUploadVoice = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file || !projectId) return

        uploadVoice.mutate(
            { file, characterId },
            {
                onSuccess: (data) => {
                    const result = (data || {}) as UploadedVoiceResult
                    onVoiceChange?.(characterId, result.audioUrl)
                },
                onError: (error) => {
                    if (shouldShowError(error)) {
                        alert(t('tts.uploadFailed', { error: error.message }))
                    }
                },
                onSettled: () => {
                    if (voiceFileInputRef.current) {
                        voiceFileInputRef.current.value = ''
                    }
                }
            }
        )
    }

    // Select predefined Google TTS voice
    const handleSelectPredefinedVoice = (selectedVoiceId: string) => {
        updateVoiceSettings.mutate(
            {
                characterId,
                voiceType: 'custom',
                voiceId: selectedVoiceId,
                customVoiceUrl: '',
            },
            {
                onSuccess: () => {
                    setShowVoiceSelector(false)
                    onVoiceChange?.(characterId, undefined)
                },
                onError: (error) => {
                    if (shouldShowError(error)) {
                        alert(t('tts.updateFailed', { error: error.message }))
                    }
                }
            }
        )
    }

    // Compact style
    const containerClass = compact
        ? 'border border-[var(--glass-stroke-base)] rounded-xl p-3 bg-[var(--glass-bg-surface-strong)]'
        : 'mt-4 border border-[var(--glass-stroke-base)] rounded-xl p-4 bg-[var(--glass-bg-surface-strong)]'

    const headerClass = compact
        ? 'flex items-center gap-2 mb-2 pb-2 border-b'
        : 'flex items-center gap-2 mb-3 pb-2 border-b'

    const iconSize = compact ? 'w-5 h-5' : 'w-6 h-6'
    const innerIconSize = compact ? 'w-3 h-3' : 'w-3.5 h-3.5'

    return (
        <div className={containerClass}>
            <div className={`${headerClass} ${hasAnyVoice ? 'border-[var(--glass-stroke-base)]' : 'border-[var(--glass-stroke-warning)]'}`}>
                <div className={`${iconSize} rounded-full flex items-center justify-center ${hasAnyVoice ? 'bg-[var(--glass-bg-muted)]' : 'bg-[var(--glass-tone-warning-bg)]'}`}>
                    <AppIcon name="mic" className={`${innerIconSize} ${hasAnyVoice ? 'text-[var(--glass-text-secondary)]' : 'text-[var(--glass-tone-warning-fg)]'}`} />
                </div>
                <span className={`text-${compact ? 'xs' : 'sm'} font-medium ${hasAnyVoice ? 'text-[var(--glass-text-secondary)]' : 'text-[var(--glass-tone-warning-fg)]'}`}>
                    {t('tts.title')}{!hasAnyVoice && <span className="text-[var(--glass-tone-warning-fg)]">({t('tts.noVoice')})</span>}
                </span>
            </div>

            {/* Show selected predefined voice */}
            {hasPredefinedVoice && selectedVoice && (
                <div className="mb-2 px-2 py-1.5 bg-[var(--glass-tone-info-bg)] border border-[var(--glass-stroke-focus)] rounded-lg">
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                            <AppIcon name="mic" className="w-3.5 h-3.5 text-[var(--glass-tone-info-fg)]" />
                            <span className="text-xs text-[var(--glass-tone-info-fg)] font-medium">{selectedVoice.name}</span>
                        </div>
                        <button
                            onClick={() => handleSelectPredefinedVoice('')}
                            className="text-[var(--glass-tone-info-fg)] hover:text-[var(--glass-tone-warning-fg)] transition-colors"
                            title="Clear voice"
                        >
                            <AppIcon name="close" className="w-3 h-3" />
                        </button>
                    </div>
                </div>
            )}

            {/* Hidden audio input */}
            <input
                ref={voiceFileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleUploadVoice}
                className="hidden"
            />

            <div className="flex flex-wrap gap-2 w-full justify-center">
                {/* Upload audio button */}
                <button
                    onClick={() => voiceFileInputRef.current?.click()}
                    disabled={uploadVoice.isPending}
                    className="flex-1 min-w-[80px] px-2 py-1.5 bg-[var(--glass-bg-surface)] border border-[var(--glass-stroke-base)] rounded-lg text-xs text-[var(--glass-text-secondary)] font-medium hover:border-[var(--glass-stroke-success)] hover:bg-[var(--glass-tone-success-bg)] hover:text-[var(--glass-tone-success-fg)] transition-all relative group whitespace-nowrap"
                >
                    <div className="flex items-center justify-center gap-1">
                        {hasCustomVoice && <div className="w-1.5 h-1.5 bg-[var(--glass-tone-success-fg)] rounded-full flex-shrink-0"></div>}
                        <span>{uploadVoice.isPending ? t('tts.uploading') : hasCustomVoice ? t('tts.uploaded') : t('tts.uploadAudio')}</span>
                    </div>
                </button>

                {/* Select predefined voice button */}
                <button
                    onClick={() => setShowVoiceSelector(!showVoiceSelector)}
                    className="flex-1 min-w-[80px] px-2 py-1.5 bg-[var(--glass-bg-surface)] border border-[var(--glass-stroke-base)] rounded-lg text-xs text-[var(--glass-text-secondary)] font-medium hover:border-[var(--glass-stroke-focus)] hover:bg-[var(--glass-tone-info-bg)] hover:text-[var(--glass-tone-info-fg)] transition-all whitespace-nowrap"
                >
                    <div className="flex items-center justify-center gap-1">
                        {hasPredefinedVoice && <div className="w-1.5 h-1.5 bg-[var(--glass-tone-success-fg)] rounded-full flex-shrink-0"></div>}
                        <AppIcon name="mic" className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{hasPredefinedVoice ? 'Voice Set' : 'Select Voice'}</span>
                    </div>
                </button>

                {/* Select from hub button */}
                {onSelectFromHub && (
                    <button
                        onClick={() => onSelectFromHub(characterId)}
                        className="flex-1 min-w-[80px] px-2 py-1.5 bg-[var(--glass-bg-surface)] border border-[var(--glass-stroke-focus)] rounded-lg text-xs text-[var(--glass-tone-info-fg)] font-medium hover:border-[var(--glass-stroke-focus)] hover:bg-[var(--glass-tone-info-bg)] transition-all whitespace-nowrap"
                    >
                        <div className="flex items-center justify-center gap-1">
                            <AppIcon name="copy" className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{t('assetLibrary.button')}</span>
                        </div>
                    </button>
                )}

                {/* AI design button */}
                {onVoiceDesign && (
                    <button
                        onClick={() => onVoiceDesign(characterId, characterName)}
                        className="glass-btn-base glass-btn-primary flex-1 min-w-[80px] px-2 py-1.5 text-xs font-medium whitespace-nowrap"
                    >
                        <div className="flex items-center justify-center gap-1">
                            <AppIcon name="bolt" className="w-3.5 h-3.5 flex-shrink-0" />
                            <span>{t('modal.aiDesign')}</span>
                        </div>
                    </button>
                )}
            </div>

            {/* Voice selector dropdown */}
            {showVoiceSelector && (
                <div className="mt-2 border border-[var(--glass-stroke-base)] rounded-lg bg-[var(--glass-bg-surface)] max-h-48 overflow-y-auto">
                    <div className="p-2 space-y-1">
                        {GOOGLE_TTS_VOICES.map((voice) => (
                            <button
                                key={voice.id}
                                onClick={() => handleSelectPredefinedVoice(voice.id)}
                                disabled={updateVoiceSettings.isPending}
                                className={`w-full px-3 py-2 rounded-lg text-left text-xs transition-all ${
                                    voiceId === voice.id
                                        ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] border border-[var(--glass-stroke-focus)]'
                                        : 'bg-[var(--glass-bg-surface)] text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-muted)] hover:text-[var(--glass-text-primary)]'
                                } disabled:opacity-50`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium">{voice.name}</span>
                                    {voiceId === voice.id && (
                                        <AppIcon name="check" className="w-3.5 h-3.5 flex-shrink-0" />
                                    )}
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Preview button - when audio exists */}
            {hasCustomVoice && (
                <button
                    onClick={handlePreviewVoice}
                    className={`w-full mt-2 px-3 py-2 border rounded-lg text-sm font-medium transition-all ${isPreviewingVoice
                        ? 'bg-[var(--glass-accent-from)] border-[var(--glass-stroke-focus)] text-white hover:bg-[var(--glass-accent-to)]'
                        : 'bg-[var(--glass-tone-info-bg)] border-[var(--glass-stroke-focus)] text-[var(--glass-tone-info-fg)] hover:bg-[var(--glass-tone-info-bg)]'
                        }`}
                >
                    <div className="flex items-center justify-center gap-2">
                        {isPreviewingVoice ? (
                            <AppIcon name="pause" className="w-4 h-4" />
                        ) : (
                            <AppIcon name="play" className="w-4 h-4" />
                        )}
                        {isPreviewingVoice ? t('tts.pause') : t('tts.preview')}
                    </div>
                </button>
            )}
        </div>
    )
}
    type UploadedVoiceResult = { audioUrl?: string }
