/**
 * Unified config service
 *
 * All APIs get model config through this service for consistent data source.
 *
 * Priority: project config > user preference > null
 */

import { prisma } from '@/lib/prisma'
import {
  type CapabilitySelections,
  type CapabilityValue,
  composeModelKey as composeStrictModelKey,
  parseModelKeyStrict,
} from '@/lib/model-config-contract'
import { findBuiltinCapabilities } from '@/lib/model-capabilities/catalog'
import { resolveGenerationOptionsForModel } from '@/lib/model-capabilities/lookup'

export type ParsedModelKey = { provider: string, modelId: string }

/**
 * Parse model composite key (strict mode, only accepts provider::modelId)
 */
export function parseModelKey(key: string | null | undefined): ParsedModelKey | null {
  const parsed = parseModelKeyStrict(key)
  if (!parsed) return null
  return {
    provider: parsed.provider,
    modelId: parsed.modelId,
  }
}

/**
 * Compose provider and modelId into standard composite key.
 */
export function composeModelKey(provider: string, modelId: string): string {
  return composeStrictModelKey(provider, modelId)
}

/**
 * Extract actual modelId from composite key (for API calls)
 */
export function extractModelId(key: string | null | undefined): string | null {
  const parsed = parseModelKey(key)
  return parsed?.modelId || null
}

/**
 * Extract standard modelKey from model field (provider::modelId)
 */
export function extractModelKey(key: string | null | undefined): string | null {
  const parsed = parseModelKey(key)
  if (!parsed?.provider || !parsed?.modelId) return null
  return composeModelKey(parsed.provider, parsed.modelId)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isCapabilityValue(value: unknown): value is CapabilityValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function normalizeCapabilitySelections(raw: unknown): CapabilitySelections {
  if (!isRecord(raw)) return {}

  const normalized: CapabilitySelections = {}
  for (const [modelKey, rawSelection] of Object.entries(raw)) {
    if (!isRecord(rawSelection)) continue

    const selection: Record<string, CapabilityValue> = {}
    for (const [field, value] of Object.entries(rawSelection)) {
      if (field === 'aspectRatio') continue
      if (!isCapabilityValue(value)) continue
      selection[field] = value
    }

    if (Object.keys(selection).length > 0) {
      normalized[modelKey] = selection
    }
  }

  return normalized
}

function parseCapabilitySelections(raw: string | null | undefined): CapabilitySelections {
  if (!raw) return {}
  try {
    return normalizeCapabilitySelections(JSON.parse(raw) as unknown)
  } catch {
    return {}
  }
}

export interface ProjectModelConfig {
  analysisModel: string | null
  characterModel: string | null
  locationModel: string | null
  storyboardModel: string | null
  editModel: string | null
  videoModel: string | null
  videoRatio: string | null
  artStyle: string | null
  capabilityDefaults: CapabilitySelections
  capabilityOverrides: CapabilitySelections
}

export interface UserModelConfig {
  analysisModel: string | null
  characterModel: string | null
  locationModel: string | null
  storyboardModel: string | null
  editModel: string | null
  videoModel: string | null
  capabilityDefaults: CapabilitySelections
}

/**
 * Get project-level model config
 */
export async function getProjectModelConfig(
  projectId: string,
  userId: string,
): Promise<ProjectModelConfig> {
  const [projectData, userPref] = await Promise.all([
    prisma.novelPromotionProject.findUnique({ where: { projectId } }),
    prisma.userPreference.findUnique({ where: { userId } }),
  ])

  return {
    analysisModel: extractModelKey(projectData?.analysisModel) || extractModelKey(userPref?.analysisModel) || null,
    characterModel: extractModelKey(projectData?.characterModel) || null,
    locationModel: extractModelKey(projectData?.locationModel) || null,
    storyboardModel: extractModelKey(projectData?.storyboardModel) || null,
    editModel: extractModelKey(projectData?.editModel) || null,
    videoModel: extractModelKey(projectData?.videoModel) || null,
    videoRatio: projectData?.videoRatio || '16:9',
    artStyle: projectData?.artStyle || null,
    capabilityDefaults: parseCapabilitySelections(userPref?.capabilityDefaults),
    capabilityOverrides: parseCapabilitySelections(projectData?.capabilityOverrides),
  }
}

/**
 * Get user-level model config (when no project)
 */
export async function getUserModelConfig(userId: string): Promise<UserModelConfig> {
  const userPref = await prisma.userPreference.findUnique({
    where: { userId },
  })

  return {
    analysisModel: extractModelKey(userPref?.analysisModel) || null,
    characterModel: extractModelKey(userPref?.characterModel) || null,
    locationModel: extractModelKey(userPref?.locationModel) || null,
    storyboardModel: extractModelKey(userPref?.storyboardModel) || null,
    editModel: extractModelKey(userPref?.editModel) || null,
    videoModel: extractModelKey(userPref?.videoModel) || null,
    capabilityDefaults: parseCapabilitySelections(userPref?.capabilityDefaults),
  }
}

export function resolveModelCapabilityGenerationOptions(input: {
  modelType: 'llm' | 'image' | 'video'
  modelKey: string
  capabilityDefaults?: CapabilitySelections
  capabilityOverrides?: CapabilitySelections
  runtimeSelections?: Record<string, CapabilityValue>
}): Record<string, CapabilityValue> {
  const parsed = parseModelKeyStrict(input.modelKey)
  if (!parsed) {
    throw new Error(`MODEL_KEY_INVALID: ${input.modelKey}`)
  }

  const capabilities = findBuiltinCapabilities(input.modelType, parsed.provider, parsed.modelId)
  const resolved = resolveGenerationOptionsForModel({
    modelType: input.modelType,
    modelKey: input.modelKey,
    capabilities,
    capabilityDefaults: input.capabilityDefaults,
    capabilityOverrides: input.capabilityOverrides,
    runtimeSelections: input.runtimeSelections,
    requireAllFields: input.modelType !== 'llm',
  })

  if (resolved.issues.length > 0) {
    const first = resolved.issues[0]
    throw new Error(`${first.code}: ${first.field} ${first.message}`)
  }

  return resolved.options
}

export async function resolveProjectModelCapabilityGenerationOptions(input: {
  projectId: string
  userId: string
  modelType: 'llm' | 'image' | 'video'
  modelKey: string
  runtimeSelections?: Record<string, CapabilityValue>
}): Promise<Record<string, CapabilityValue>> {
  const config = await getProjectModelConfig(input.projectId, input.userId)
  return resolveModelCapabilityGenerationOptions({
    modelType: input.modelType,
    modelKey: input.modelKey,
    capabilityDefaults: config.capabilityDefaults,
    capabilityOverrides: config.capabilityOverrides,
    runtimeSelections: input.runtimeSelections,
  })
}

/**
 * Check that required model config fields exist
 */
export function checkRequiredModels(
  config: Partial<ProjectModelConfig | UserModelConfig>,
  requiredFields: (keyof ProjectModelConfig | keyof UserModelConfig)[],
): string[] {
  const missing: string[] = []
  const configValues = config as Record<string, unknown>

  const fieldNames: Record<string, string> = {
    analysisModel: 'AI analysis model',
    characterModel: 'Character image model',
    locationModel: 'Location image model',
    storyboardModel: 'Storyboard image model',
    editModel: 'Image edit model',
    videoModel: 'Video model',
  }

  for (const field of requiredFields) {
    if (!configValues[field]) {
      missing.push(fieldNames[field] || field)
    }
  }

  return missing
}

/**
 * Build error message for missing config
 */
export function getMissingConfigError(missingFields: string[]): string {
  if (missingFields.length === 0) return ''
  if (missingFields.length === 1) {
    return `Please configure "${missingFields[0]}" in project settings first`
  }
  return `Please configure the following in project settings: ${missingFields.join(', ')}`
}

/**
 * Build billingPayload for image tasks (project-level, async).
 * Resolution must be configured in project settings; it is injected into
 * billingPayload.generationOptions and task payload (imageSize for worker/API).
 */
export async function buildImageBillingPayload(input: {
  projectId: string
  userId: string
  imageModel: string | null
  basePayload: Record<string, unknown>
}): Promise<Record<string, unknown>> {
  const { projectId, userId, imageModel, basePayload } = input
  if (!imageModel) return basePayload

  let capabilityOptions: Record<string, CapabilityValue> = {}
  try {
    capabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
      projectId,
      userId,
      modelType: 'image',
      modelKey: imageModel,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw Object.assign(new Error(message), { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }

  return {
    ...basePayload,
    imageModel,
    ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {}),
  }
}

/**
 * Build billingPayload for image tasks (user-level, sync).
 * Used when there is no projectId (e.g. asset-hub), with pre-fetched userModelConfig.
 */
export function buildImageBillingPayloadFromUserConfig(input: {
  userModelConfig: UserModelConfig
  imageModel: string | null
  basePayload: Record<string, unknown>
}): Record<string, unknown> {
  const { userModelConfig, imageModel, basePayload } = input
  if (!imageModel) return basePayload

  let capabilityOptions: Record<string, CapabilityValue> = {}
  try {
    capabilityOptions = resolveModelCapabilityGenerationOptions({
      modelType: 'image',
      modelKey: imageModel,
      capabilityDefaults: userModelConfig.capabilityDefaults,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Image model capability not configured'
    throw Object.assign(new Error(message), { code: 'IMAGE_MODEL_CAPABILITY_NOT_CONFIGURED', message })
  }

  return {
    ...basePayload,
    imageModel,
    ...(Object.keys(capabilityOptions).length > 0 ? { generationOptions: capabilityOptions } : {}),
  }
}
