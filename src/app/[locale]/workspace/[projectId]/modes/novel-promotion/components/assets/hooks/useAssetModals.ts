'use client'

/**
 * useAssetModals - asset modal state
 * Extracted from AssetsStage
 * 
 * V6.5: subscribe useProjectAssets, no props drilling
 */

import { useState, useCallback } from 'react'
import { CharacterAppearance } from '@/types/project'
import { useProjectAssets, type Character, type Location } from '@/lib/query/hooks'

// Edit modal state type
interface EditingAppearance {
    characterId: string
    characterName: string
    appearanceId: string  // UUID
    description: string
    descriptionIndex?: number
    introduction?: string | null  // Character intro
}

interface EditingLocation {
    locationId: string
    locationName: string
    description: string
}

interface ImageEditModal {
    locationId: string
    imageIndex: number
    locationName: string
}

interface CharacterImageEditModal {
    characterId: string
    appearanceId: string
    imageIndex: number
    characterName: string
}

interface UseAssetModalsProps {
    projectId: string
}

export function useAssetModals({
    projectId
}: UseAssetModalsProps) {
    // Subscribe cache directly
    const { data: assets } = useProjectAssets(projectId)
    const characters = assets?.characters ?? []
    const locations = assets?.locations ?? []

    // Get appearance list (built-in)
    const getAppearances = useCallback((character: Character): CharacterAppearance[] => {
        return character.appearances || []
    }, [])

    // Character edit modal
    const [editingAppearance, setEditingAppearance] = useState<EditingAppearance | null>(null)
    // Location edit modal
    const [editingLocation, setEditingLocation] = useState<EditingLocation | null>(null)
    // Add modal
    const [showAddCharacter, setShowAddCharacter] = useState(false)
    const [showAddLocation, setShowAddLocation] = useState(false)
    // Image edit modal
    const [imageEditModal, setImageEditModal] = useState<ImageEditModal | null>(null)
    const [characterImageEditModal, setCharacterImageEditModal] = useState<CharacterImageEditModal | null>(null)
    // Global asset modal
    const [showAssetSettingModal, setShowAssetSettingModal] = useState(false)

    // Edit character appearance by description index
    const handleEditCharacterDescription = (characterId: string, appearanceIndex: number, descriptionIndex: number) => {
        const character = characters.find(c => c.id === characterId)
        if (!character) return
        const appearances = getAppearances(character)
        const appearance = appearances.find(a => a.appearanceIndex === appearanceIndex)
        if (!appearance) return

        const descriptions = appearance.descriptions || [appearance.description || '']
        const description = descriptions[descriptionIndex] || appearance.description || ''

        setEditingAppearance({
            characterId,
            characterName: character.name,
            appearanceId: appearance.id,
            description: description,
            descriptionIndex
        })
    }

    // Edit location by description index
    const handleEditLocationDescription = (locationId: string, imageIndex: number) => {
        const location = locations.find(l => l.id === locationId)
        if (!location) return

        const image = location.images?.find(img => img.imageIndex === imageIndex)
        const description = image?.description || ''

        setEditingLocation({
            locationId,
            locationName: location.name,
            description: description
        })
    }

    // Edit character appearance
    const handleEditAppearance = (characterId: string, characterName: string, appearance: CharacterAppearance, introduction?: string | null) => {
        setEditingAppearance({
            characterId,
            characterName,
            appearanceId: appearance.id,
            description: appearance.description || '',
            introduction
        })
    }

    // Edit location
    const handleEditLocation = (location: Location) => {
        const firstImage = location.images?.[0]
        setEditingLocation({
            locationId: location.id,
            locationName: location.name,
            description: firstImage?.description || ''
        })
    }

    // Open location image edit modal
    const handleOpenLocationImageEdit = (locationId: string, imageIndex: number) => {
        const location = locations.find(l => l.id === locationId)
        if (!location) return

        setImageEditModal({
            locationId,
            imageIndex,
            locationName: location.name
        })
    }

    // Open character image edit modal
    const handleOpenCharacterImageEdit = (characterId: string, appearanceId: string, imageIndex: number, characterName: string) => {
        setCharacterImageEditModal({
            characterId,
            appearanceId,
            imageIndex,
            characterName
        })
    }

    // Close all modals
    const closeEditingAppearance = () => setEditingAppearance(null)
    const closeEditingLocation = () => setEditingLocation(null)
    const closeAddCharacter = () => setShowAddCharacter(false)
    const closeAddLocation = () => setShowAddLocation(false)
    const closeImageEditModal = () => setImageEditModal(null)
    const closeCharacterImageEditModal = () => setCharacterImageEditModal(null)
    const closeAssetSettingModal = () => setShowAssetSettingModal(false)

    return {
        // Expose data for component
        characters,
        locations,
        getAppearances,
        // State
        editingAppearance,
        editingLocation,
        showAddCharacter,
        showAddLocation,
        imageEditModal,
        characterImageEditModal,
        showAssetSettingModal,
        // Setters
        setEditingAppearance,
        setEditingLocation,
        setShowAddCharacter,
        setShowAddLocation,
        setImageEditModal,
        setCharacterImageEditModal,
        setShowAssetSettingModal,
        // Handlers
        handleEditCharacterDescription,
        handleEditLocationDescription,
        handleEditAppearance,
        handleEditLocation,
        handleOpenLocationImageEdit,
        handleOpenCharacterImageEdit,
        // Close helpers
        closeEditingAppearance,
        closeEditingLocation,
        closeAddCharacter,
        closeAddLocation,
        closeImageEditModal,
        closeCharacterImageEditModal,
        closeAssetSettingModal
    }
}
