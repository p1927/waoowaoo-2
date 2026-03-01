'use client'
import { logError as _ulogError } from '@/lib/logging/core'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import Navbar from '@/components/Navbar'
import { FolderSidebar } from './components/FolderSidebar'
import { AssetGrid } from './components/AssetGrid'
import { CharacterCreationModal, LocationCreationModal, CharacterEditModal, LocationEditModal } from '@/components/shared/assets'
import { FolderModal } from './components/FolderModal'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import ImageEditModal from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/assets/ImageEditModal'
import VoiceDesignDialog from './components/VoiceDesignDialog'
import VoiceCreationModal from './components/VoiceCreationModal'
import VoicePickerDialog from './components/VoicePickerDialog'
import {
    useGlobalCharacters,
    useGlobalLocations,
    useGlobalVoices,
    useGlobalFolders,
    useSSE,
    useModifyCharacterImage,
    useModifyLocationImage,
    type GlobalCharacter,
} from '@/lib/query/hooks'
import { queryKeys } from '@/lib/query/keys'
import { AppIcon } from '@/components/ui/icons'

export default function AssetHubPage() {
    const t = useTranslations('assetHub')
    const queryClient = useQueryClient()

    // Folder selection state
    const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null)

    // Use React Query to fetch data
    const { data: folders = [], isLoading: foldersLoading } = useGlobalFolders()
    const { data: characters = [], isLoading: charactersLoading } = useGlobalCharacters(selectedFolderId)
    const { data: locations = [], isLoading: locationsLoading } = useGlobalLocations(selectedFolderId)
    const { data: voices = [], isLoading: voicesLoading } = useGlobalVoices(selectedFolderId)

    const loading = foldersLoading || charactersLoading || locationsLoading || voicesLoading
    useSSE({ projectId: 'global-asset-hub', enabled: true })

    // Mutation hooks
    const modifyCharacterImage = useModifyCharacterImage()
    const modifyLocationImage = useModifyLocationImage()

    // Modal state
    const [showAddCharacter, setShowAddCharacter] = useState(false)
    const [showAddLocation, setShowAddLocation] = useState(false)
    const [showFolderModal, setShowFolderModal] = useState(false)
    const [editingFolder, setEditingFolder] = useState<{ id: string; name: string } | null>(null)
    const [previewImage, setPreviewImage] = useState<string | null>(null)
    const [imageEditModal, setImageEditModal] = useState<{
        type: 'character' | 'location'
        id: string
        name: string
        imageIndex: number
        appearanceIndex?: number
    } | null>(null)

    const [voiceDesignCharacter, setVoiceDesignCharacter] = useState<{
        id: string
        name: string
        hasExistingVoice: boolean
    } | null>(null)

    // Voice library modal state
    const [showAddVoice, setShowAddVoice] = useState(false)
    const [voicePickerCharacterId, setVoicePickerCharacterId] = useState<string | null>(null)

    // Character edit modal state
    const [characterEditModal, setCharacterEditModal] = useState<{
        characterId: string
        characterName: string
        appearanceId: string
        appearanceIndex: number
        changeReason: string
        description: string
    } | null>(null)

    // Location edit modal state
    const [locationEditModal, setLocationEditModal] = useState<{
        locationId: string
        locationName: string
        summary: string
        imageIndex: number
        description: string
    } | null>(null)

    // Create folder
    const handleCreateFolder = async (name: string) => {
        try {
            const res = await fetch('/api/asset-hub/folders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            })
            if (res.ok) {
                queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.folders() })
                setShowFolderModal(false)
            }
        } catch (error) {
            _ulogError('Create folder failed:', error)
        }
    }

    // Update folder
    const handleUpdateFolder = async (folderId: string, name: string) => {
        try {
            const res = await fetch(`/api/asset-hub/folders/${folderId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            })
            if (res.ok) {
                queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.folders() })
                setEditingFolder(null)
                setShowFolderModal(false)
            }
        } catch (error) {
            _ulogError('Update folder failed:', error)
        }
    }

    // Delete folder
    const handleDeleteFolder = async (folderId: string) => {
        if (!confirm(t('confirmDeleteFolder'))) return

        try {
            const res = await fetch(`/api/asset-hub/folders/${folderId}`, {
                method: 'DELETE'
            })
            if (res.ok) {
                if (selectedFolderId === folderId) {
                    setSelectedFolderId(null)
                }
                queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.all() })
            }
        } catch (error) {
            _ulogError('Delete folder failed:', error)
        }
    }

    // Open image edit modal
    const handleOpenImageEdit = (type: 'character' | 'location', id: string, name: string, imageIndex: number, appearanceIndex?: number) => {
        setImageEditModal({ type, id, name, imageIndex, appearanceIndex })
    }

    // Handle image edit confirm - use mutation
    const handleImageEdit = async (modifyPrompt: string, extraImageUrls?: string[]) => {
        if (!imageEditModal) return

        const { type, id, imageIndex, appearanceIndex } = imageEditModal
        setImageEditModal(null)

        if (type === 'character' && appearanceIndex !== undefined) {
            modifyCharacterImage.mutate({
                characterId: id,
                appearanceIndex,
                imageIndex,
                modifyPrompt,
                extraImageUrls
            }, {
                onError: () => {
                    alert(t('editFailed'))
                }
            })
        } else if (type === 'location') {
            modifyLocationImage.mutate({
                locationId: id,
                imageIndex,
                modifyPrompt,
                extraImageUrls
            }, {
                onError: () => {
                    alert(t('editFailed'))
                }
            })
        }
    }

    // Open AI voice design dialog
    const handleOpenVoiceDesign = (characterId: string, characterName: string) => {
        const character = characters.find(c => c.id === characterId)
        setVoiceDesignCharacter({
            id: characterId,
            name: characterName,
            hasExistingVoice: !!character?.customVoiceUrl
        })
    }

    // Save AI-designed voice
    const handleVoiceDesignSave = async (voiceId: string, audioBase64: string) => {
        if (!voiceDesignCharacter) return

        try {
            const res = await fetch('/api/asset-hub/character-voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    characterId: voiceDesignCharacter.id,
                    voiceId,
                    audioBase64
                })
            })

            if (res.ok) {
                alert(t('voiceDesignSaved', { name: voiceDesignCharacter.name }))
                queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.characters() })
            } else {
                const data = await res.json()
                alert(
                    typeof data.error === 'string'
                        ? t('saveVoiceFailedDetail', { error: data.error })
                        : t('saveVoiceFailed'),
                )
            }
        } catch (error) {
            _ulogError('Save voice failed:', error)
            alert(t('saveVoiceFailed'))
        }
    }

    // Open character edit modal
    const handleOpenCharacterEdit = (character: unknown, appearance: unknown) => {
        const typedCharacter = character as GlobalCharacter
        const typedAppearance = appearance as GlobalCharacter['appearances'][0]
        setCharacterEditModal({
            characterId: typedCharacter.id,
            characterName: typedCharacter.name,
            appearanceId: typedAppearance.id,
            appearanceIndex: typedAppearance.appearanceIndex,
            changeReason: typedAppearance.changeReason || t('appearanceLabel', { index: typedAppearance.appearanceIndex }),
            description: typedAppearance.description || ''
        })
    }

    // Open location edit modal
    const handleOpenLocationEdit = (location: unknown, imageIndex: number) => {
        const typedLocation = location as {
            id: string
            name: string
            summary: string | null
            images: Array<{ imageIndex: number; description: string | null }>
        }
        const image = typedLocation.images.find(img => img.imageIndex === imageIndex)
        setLocationEditModal({
            locationId: typedLocation.id,
            locationName: typedLocation.name,
            summary: typedLocation.summary || '',
            imageIndex: imageIndex,
            description: image?.description || typedLocation.summary || ''
        })
    }

    // Trigger generation after character edit
    const handleCharacterEditGenerate = async () => {
        if (!characterEditModal) return

        try {
            await fetch('/api/asset-hub/generate-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'character',
                    id: characterEditModal.characterId,
                    appearanceIndex: characterEditModal.appearanceIndex
                })
            })
            queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.characters() })
        } catch (error) {
            _ulogError('Trigger generation failed:', error)
        }
    }

    // Trigger generation after location edit
    const handleLocationEditGenerate = async () => {
        if (!locationEditModal) return

        try {
            await fetch('/api/asset-hub/generate-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'location',
                    id: locationEditModal.locationId
                })
            })
            queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.locations() })
        } catch (error) {
            _ulogError('Trigger generation failed:', error)
        }
    }

    // Bind voice to character after selecting from voice library
    const handleVoiceSelect = async (voice: { id: string; customVoiceUrl: string | null }) => {
        if (!voicePickerCharacterId) return

        try {
            const res = await fetch(`/api/asset-hub/characters/${voicePickerCharacterId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    globalVoiceId: voice.id,
                    customVoiceUrl: voice.customVoiceUrl
                })
            })

            if (res.ok) {
                queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.characters() })
                setVoicePickerCharacterId(null)
            } else {
                const data = await res.json()
                alert(
                    typeof data.error === 'string'
                        ? t('bindVoiceFailedDetail', { error: data.error })
                        : t('bindVoiceFailed'),
                )
            }
        } catch (error) {
            _ulogError('Bind voice failed:', error)
            alert(t('bindVoiceFailed'))
        }
    }

    return (
        <div className="glass-page min-h-screen">
            <Navbar />
            <div className="max-w-7xl mx-auto px-4 py-6">
                {/* Page title */}
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-[var(--glass-text-primary)]">{t('title')}</h1>
                    <p className="text-sm text-[var(--glass-text-secondary)] mt-1">{t('description')}</p>
                    <p className="text-xs text-[var(--glass-text-tertiary)] mt-2 flex items-center gap-1">
                        <AppIcon name="info" className="w-3.5 h-3.5" />
                        {t('modelHint')}
                        <Link href="/profile" className="text-[var(--glass-tone-info-fg)] hover:underline">{t('modelHintLink')}</Link>
                        {t('modelHintSuffix')}
                    </p>
                </div>

                <div className="flex gap-6">
                    {/* Left folder tree */}
                    <FolderSidebar
                        folders={folders}
                        selectedFolderId={selectedFolderId}
                        onSelectFolder={setSelectedFolderId}
                        onCreateFolder={() => {
                            setEditingFolder(null)
                            setShowFolderModal(true)
                        }}
                        onEditFolder={(folder) => {
                            setEditingFolder(folder)
                            setShowFolderModal(true)
                        }}
                        onDeleteFolder={handleDeleteFolder}
                    />

                    {/* Right asset grid */}
                    <AssetGrid
                        characters={characters}
                        locations={locations}
                        voices={voices}
                        loading={loading}
                        onAddCharacter={() => setShowAddCharacter(true)}
                        onAddLocation={() => setShowAddLocation(true)}
                        onAddVoice={() => setShowAddVoice(true)}
                        selectedFolderId={selectedFolderId}
                        onImageClick={setPreviewImage}
                        onImageEdit={handleOpenImageEdit}
                        onVoiceDesign={handleOpenVoiceDesign}
                        onCharacterEdit={handleOpenCharacterEdit}
                        onLocationEdit={handleOpenLocationEdit}
                        onVoiceSelect={(characterId) => setVoicePickerCharacterId(characterId)}
                    />
                </div>
            </div>

            {/* New character modal */}
            {showAddCharacter && (
                <CharacterCreationModal
                    mode="asset-hub"
                    folderId={selectedFolderId}
                    onClose={() => setShowAddCharacter(false)}
                    onSuccess={() => {
                        setShowAddCharacter(false)
                        queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.characters() })
                    }}
                />
            )}

            {/* New location modal */}
            {showAddLocation && (
                <LocationCreationModal
                    mode="asset-hub"
                    folderId={selectedFolderId}
                    onClose={() => setShowAddLocation(false)}
                    onSuccess={() => {
                        setShowAddLocation(false)
                        queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.locations() })
                    }}
                />
            )}

            {/* Folder edit modal */}
            {showFolderModal && (
                <FolderModal
                    folder={editingFolder}
                    onClose={() => {
                        setShowFolderModal(false)
                        setEditingFolder(null)
                    }}
                    onSave={(name) => {
                        if (editingFolder) {
                            handleUpdateFolder(editingFolder.id, name)
                        } else {
                            handleCreateFolder(name)
                        }
                    }}
                />
            )}

            {/* Image preview modal */}
            {previewImage && (
                <ImagePreviewModal
                    imageUrl={previewImage}
                    onClose={() => setPreviewImage(null)}
                />
            )}

            {/* Image edit modal */}
            {imageEditModal && (
                <ImageEditModal
                    type={imageEditModal.type}
                    name={imageEditModal.name}
                    onClose={() => setImageEditModal(null)}
                    onConfirm={handleImageEdit}
                />
            )}

            {/* AI voice design dialog */}
            {voiceDesignCharacter && (
                <VoiceDesignDialog
                    isOpen={!!voiceDesignCharacter}
                    speaker={voiceDesignCharacter.name}
                    hasExistingVoice={voiceDesignCharacter.hasExistingVoice}
                    onClose={() => setVoiceDesignCharacter(null)}
                    onSave={handleVoiceDesignSave}
                />
            )}

            {/* Character edit modal */}
            {characterEditModal && (
                <CharacterEditModal
                    mode="asset-hub"
                    characterId={characterEditModal.characterId}
                    characterName={characterEditModal.characterName}
                    appearanceId={characterEditModal.appearanceId}
                    appearanceIndex={characterEditModal.appearanceIndex}
                    changeReason={characterEditModal.changeReason}
                    description={characterEditModal.description}
                    onClose={() => setCharacterEditModal(null)}
                    onSave={handleCharacterEditGenerate}
                />
            )}

            {/* Location edit modal */}
            {locationEditModal && (
                <LocationEditModal
                    mode="asset-hub"
                    locationId={locationEditModal.locationId}
                    locationName={locationEditModal.locationName}
                    summary={locationEditModal.summary}
                    imageIndex={locationEditModal.imageIndex}
                    description={locationEditModal.description}
                    onClose={() => setLocationEditModal(null)}
                    onSave={handleLocationEditGenerate}
                />
            )}

            {/* New voice modal */}
            {showAddVoice && (
                <VoiceCreationModal
                    isOpen={showAddVoice}
                    folderId={selectedFolderId}
                    onClose={() => setShowAddVoice(false)}
                    onSuccess={() => {
                        setShowAddVoice(false)
                        queryClient.invalidateQueries({ queryKey: queryKeys.globalAssets.voices() })
                    }}
                />
            )}

            {/* Voice picker from library modal */}
            {voicePickerCharacterId && (
                <VoicePickerDialog
                    isOpen={!!voicePickerCharacterId}
                    onClose={() => setVoicePickerCharacterId(null)}
                    onSelect={handleVoiceSelect}
                />
            )}
        </div>
    )
}
