import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { resolveTaskResponse } from '@/lib/task/client'
import {
  invalidateQueryTemplates,
  requestJsonWithError,
  requestTaskResponseWithError,
} from './mutation-shared'

export function useUpdateProjectCharacterIntroduction(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async ({
            characterId,
            introduction,
        }: {
            characterId: string
            introduction: string
        }) => {
            return await requestJsonWithError(`/api/novel-promotion/${projectId}/character`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ characterId, introduction }),
            }, 'Failed to update character introduction')
        },
        onSuccess: invalidateProjectAssets,
    })
}

/**
 * AI modify project character appearance description
 */

export function useAiModifyProjectAppearanceDescription(projectId: string) {
    return useMutation({
        mutationFn: async ({
            characterId,
            appearanceId,
            currentDescription,
            modifyInstruction,
        }: {
            characterId: string
            appearanceId: string
            currentDescription: string
            modifyInstruction: string
        }) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/ai-modify-appearance`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        characterId,
                        appearanceId,
                        currentDescription,
                        modifyInstruction,
                    }),
                },
                'Failed to modify appearance description',
            )
            return resolveTaskResponse<{ modifiedDescription?: string }>(response)
        },
    })
}

/**
 * AI create project character
 */

export function useAiCreateProjectCharacter(projectId: string) {
    return useMutation({
        mutationFn: async (payload: { userInstruction: string }) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/ai-create-character`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'Failed to design character',
            )
            return await resolveTaskResponse<{ prompt?: string }>(response)
        },
    })
}

/**
 * Upload temporary media (project)
 */

export function useUploadProjectTempMedia() {
    return useMutation({
        mutationFn: async (payload: { imageBase64?: string; base64?: string; extension?: string; type?: string }) => {
            return await requestJsonWithError<{ success: boolean; url?: string; key?: string }>(
                '/api/asset-hub/upload-temp',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'Upload failed',
            )
        },
    })
}

/**
 * Extract character description from reference image (project)
 */

export function useExtractProjectReferenceCharacterDescription(projectId: string) {
    return useMutation({
        mutationFn: async (referenceImageUrls: string[]) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/reference-to-character`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        referenceImageUrls,
                        extractOnly: true,
                    }),
                },
                'Failed to extract character description',
            )
            return resolveTaskResponse<{ description?: string }>(response)
        },
    })
}

/**
 * Create project character
 */

export function useCreateProjectCharacter(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async (payload: {
            name: string
            description: string
            artStyle?: string
            generateFromReference?: boolean
            referenceImageUrls?: string[]
            customDescription?: string
        }) =>
            await requestJsonWithError(
                `/api/novel-promotion/${projectId}/character`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'Failed to create character',
            ),
        onSuccess: invalidateProjectAssets,
    })
}

/**
 * Add sub-appearance to project character
 */

export function useCreateProjectCharacterAppearance(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])

    return useMutation({
        mutationFn: async (payload: {
            characterId: string
            changeReason: string
            description: string
        }) =>
            await requestJsonWithError(
                `/api/novel-promotion/${projectId}/character/appearance`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'Failed to create character appearance',
            ),
        onSuccess: invalidateProjectAssets,
    })
}

/**
 * Global asset analysis (project)
 */

export function useConfirmProjectCharacterSelection(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
    return useMutation({
        mutationFn: async ({ characterId, appearanceId }: { characterId: string; appearanceId: string }) =>
            await requestJsonWithError(
                `/api/novel-promotion/${projectId}/character/confirm-selection`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ characterId, appearanceId }),
                },
                'Confirm selection failed',
            ),
        onSettled: invalidateProjectAssets,
    })
}

/**
 * Confirm scene candidate image selection
 */

export function useConfirmProjectCharacterProfile(projectId: string) {
    const queryClient = useQueryClient()
    const invalidateProjectAssets = () =>
        invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
    return useMutation({
        mutationFn: async (payload: {
            characterId: string
            profileData?: unknown
            generateImage?: boolean
        }) => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/character-profile/confirm`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                },
                'Confirm failed',
            )
            return await resolveTaskResponse<{
                success?: boolean
                character?: {
                    id?: string
                    profileConfirmed?: boolean
                    appearances?: Array<{
                        id?: number
                        descriptions?: string[]
                    }>
                }
            }>(response)
        },
        onSettled: invalidateProjectAssets,
    })
}

/**
 * Batch confirm character profiles
 */

export function useBatchConfirmProjectCharacterProfiles(projectId: string) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async () => {
            const response = await requestTaskResponseWithError(
                `/api/novel-promotion/${projectId}/character-profile/batch-confirm`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                },
                'Batch confirm failed',
            )
            return await resolveTaskResponse<{
                success?: boolean
                count?: number
                message?: string
            }>(response)
        },
        onSettled: () => {
            invalidateQueryTemplates(queryClient, [queryKeys.projectAssets.all(projectId)])
        },
    })
}
