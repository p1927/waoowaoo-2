'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useLocale, useTranslations } from 'next-intl'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
    Provider,
    CustomModel,
    PRESET_PROVIDERS,
    PRESET_MODELS,
    encodeModelKey,
    getProviderKey,
    isPresetComingSoonModelKey,
    resolvePresetProviderName,
    type PricingDisplayItem,
    type PricingDisplayMap,
} from './types'
import type { CapabilitySelections, CapabilityValue } from '@/lib/model-config-contract'

interface DefaultModels {
    analysisModel?: string
    characterModel?: string
    locationModel?: string
    storyboardModel?: string
    editModel?: string
    videoModel?: string
    lipSyncModel?: string
}

interface UseProvidersReturn {
    providers: Provider[]
    models: CustomModel[]
    defaultModels: DefaultModels
    capabilityDefaults: CapabilitySelections
    loading: boolean
    saveStatus: 'idle' | 'saving' | 'saved' | 'error'
    updateProviderApiKey: (providerId: string, apiKey: string) => void
    updateProviderBaseUrl: (providerId: string, baseUrl: string) => void
    addProvider: (provider: Omit<Provider, 'hasApiKey'>) => void
    deleteProvider: (providerId: string) => void
    updateProviderInfo: (providerId: string, name: string, baseUrl?: string) => void
    toggleModel: (modelKey: string, providerId?: string) => void
    updateModel: (modelKey: string, updates: Partial<CustomModel>, providerId?: string) => void
    addModel: (model: Omit<CustomModel, 'enabled'>) => void
    deleteModel: (modelKey: string, providerId?: string) => void
    updateDefaultModel: (field: string, modelKey: string, capabilityFieldsToDefault?: Array<{ field: string; options: CapabilityValue[] }>) => void
    updateCapabilityDefault: (modelKey: string, field: string, value: string | number | boolean | null) => void
    getModelsByType: (type: CustomModel['type']) => CustomModel[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

function composePricingDisplayKey(type: CustomModel['type'], provider: string, modelId: string): string {
    return `${type}::${provider}::${modelId}`
}

function parsePricingDisplayMap(raw: unknown): PricingDisplayMap {
    if (!isRecord(raw)) return {}

    const map: PricingDisplayMap = {}
    for (const [key, value] of Object.entries(raw)) {
        if (!isRecord(value)) continue
        const min = typeof value.min === 'number' && Number.isFinite(value.min) ? value.min : null
        const max = typeof value.max === 'number' && Number.isFinite(value.max) ? value.max : null
        const label = typeof value.label === 'string' ? value.label.trim() : ''
        const input = typeof value.input === 'number' && Number.isFinite(value.input) ? value.input : undefined
        const output = typeof value.output === 'number' && Number.isFinite(value.output) ? value.output : undefined
        if (min === null || max === null || !label) continue
        map[key] = {
            min,
            max,
            label,
            ...(typeof input === 'number' ? { input } : {}),
            ...(typeof output === 'number' ? { output } : {}),
        }
    }
    return map
}

/**
 * Provider keys that share pricing display with a canonical provider.
 */
const PRICING_DISPLAY_ALIASES: Readonly<Record<string, string>> = {
    'gemini-compatible': 'google',
}

function resolvePricingDisplay(
    map: PricingDisplayMap,
    type: CustomModel['type'],
    provider: string,
    modelId: string,
): PricingDisplayItem | null {
    const exact = map[composePricingDisplayKey(type, provider, modelId)]
    if (exact) return exact

    const providerKey = getProviderKey(provider)
    if (providerKey !== provider) {
        const fallback = map[composePricingDisplayKey(type, providerKey, modelId)]
        if (fallback) return fallback
    }

    // Fallback: check canonical provider alias (e.g. gemini-compatible → google)
    const aliasTarget = PRICING_DISPLAY_ALIASES[providerKey]
    if (aliasTarget) {
        const aliasFallback = map[composePricingDisplayKey(type, aliasTarget, modelId)]
        if (aliasFallback) return aliasFallback
    }
    return null
}

function applyPricingDisplay(model: CustomModel, map: PricingDisplayMap): CustomModel {
    const pricing = resolvePricingDisplay(map, model.type, model.provider, model.modelId)
    if (!pricing) {
        // Preserve existing server-provided pricing fields (e.g. from customPricing)
        if (model.priceLabel && model.priceLabel !== '--') {
            return model
        }
        return {
            ...model,
            price: 0,
            priceLabel: '--',
            priceMin: undefined,
            priceMax: undefined,
            priceInput: undefined,
            priceOutput: undefined,
        }
    }

    return {
        ...model,
        price: pricing.min,
        priceMin: pricing.min,
        priceMax: pricing.max,
        priceLabel: pricing.label,
        ...(typeof pricing.input === 'number' ? { priceInput: pricing.input } : {}),
        ...(typeof pricing.output === 'number' ? { priceOutput: pricing.output } : {}),
    }
}

export function useProviders(): UseProvidersReturn {
    const locale = useLocale()
    const t = useTranslations('apiConfig')
    const presetProviders = PRESET_PROVIDERS.map((provider) => ({
        ...provider,
        name: resolvePresetProviderName(provider.id, provider.name, locale),
    }))
    const [providers, setProviders] = useState<Provider[]>(
        presetProviders.map((provider) => ({ ...provider, apiKey: '', hasApiKey: false })),
    )
    const [models, setModels] = useState<CustomModel[]>(
        PRESET_MODELS.map((model) => {
            const modelKey = encodeModelKey(model.provider, model.modelId)
            return {
                ...model,
                modelKey,
                price: 0,
                priceLabel: '--',
                enabled: !isPresetComingSoonModelKey(modelKey),
            }
        }),
    )
    const [defaultModels, setDefaultModels] = useState<DefaultModels>({})
    const [capabilityDefaults, setCapabilityDefaults] = useState<CapabilitySelections>({})
    const [loading, setLoading] = useState(true)
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null)
    const initializedRef = useRef(false)

    // Refs for latest values, avoid stale closure on async save
    const latestModelsRef = useRef(models)
    const latestProvidersRef = useRef(providers)
    const latestDefaultModelsRef = useRef(defaultModels)
    const latestCapabilityDefaultsRef = useRef(capabilityDefaults)
    useEffect(() => { latestModelsRef.current = models }, [models])
    useEffect(() => { latestProvidersRef.current = providers }, [providers])
    useEffect(() => { latestDefaultModelsRef.current = defaultModels }, [defaultModels])
    useEffect(() => { latestCapabilityDefaultsRef.current = capabilityDefaults }, [capabilityDefaults])

    // Load config
    useEffect(() => {
        fetchConfig()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    async function fetchConfig() {
        initializedRef.current = false
        let loadedSuccessfully = false
        try {
            const res = await fetch('/api/user/api-config')
            if (!res.ok) {
                throw new Error(`api-config load failed: HTTP ${res.status}`)
            }

            const data = await res.json()
            const pricingDisplay = parsePricingDisplayMap((data as { pricingDisplay?: unknown }).pricingDisplay)

            // Merge preset and saved providers
            const savedProviders: Provider[] = data.providers || []
            const allProviders = presetProviders.map(preset => {
                const saved = savedProviders.find(p => getProviderKey(p.id) === preset.id)
                return {
                    ...preset,
                    apiKey: saved?.apiKey || '',
                    hasApiKey: !!saved?.apiKey,
                    // Keep user baseUrl (self-hosted)
                    baseUrl: saved?.baseUrl || preset.baseUrl
                }
            })
            const customProviders = savedProviders.filter(p =>
                !PRESET_PROVIDERS.find(preset => preset.id === getProviderKey(p.id))
            ).map(p => ({
                ...p,
                hasApiKey: !!p.apiKey
            }))
            setProviders([...allProviders, ...customProviders])

            // Merge preset and saved models
            const savedModelsRaw = data.models || []
            const savedModelsNormalized = savedModelsRaw.map((m: CustomModel) => ({
                ...m,
                modelKey: m.modelKey || encodeModelKey(m.provider, m.modelId),
            }))
            const savedModels: CustomModel[] = []
            const seen = new Set<string>()
            for (const model of savedModelsNormalized) {
                const key = model.modelKey
                if (seen.has(key)) continue
                seen.add(key)
                savedModels.push(model)
            }
            const hasSavedModels = savedModels.length > 0
            const allModels = PRESET_MODELS.map(preset => {
                const presetModelKey = encodeModelKey(preset.provider, preset.modelId)
                const saved = savedModels.find((m: CustomModel) =>
                    m.modelKey === presetModelKey
                )
                const alwaysEnabledPreset = preset.type === 'lipsync'
                const mergedPreset: CustomModel = {
                    ...preset,
                    modelKey: presetModelKey,
                    enabled: isPresetComingSoonModelKey(presetModelKey)
                        ? false
                        : (hasSavedModels ? (alwaysEnabledPreset || !!saved) : false),
                    price: 0,
                    capabilities: saved?.capabilities ?? preset.capabilities,
                }
                return applyPricingDisplay(mergedPreset, pricingDisplay)
            })
            const customModels = savedModels.filter((m: CustomModel) =>
                !PRESET_MODELS.find((preset) => encodeModelKey(preset.provider, preset.modelId) === m.modelKey)
            ).map((m: CustomModel) => ({
                ...applyPricingDisplay(m, pricingDisplay),
                // Respect server enabled (disabled presets return enabled: false)
                enabled: (m as CustomModel & { enabled?: boolean }).enabled !== false,
            }))

            setModels([...allModels, ...customModels])

            // Load default model config
            if (data.defaultModels) {
                setDefaultModels(data.defaultModels)
            }
            if (data.capabilityDefaults && typeof data.capabilityDefaults === 'object') {
                setCapabilityDefaults(data.capabilityDefaults as CapabilitySelections)
            }
            loadedSuccessfully = true
        } catch (error) {
            _ulogError('Get config failed:', error)
            setSaveStatus('error')
        } finally {
            setLoading(false)
            if (loadedSuccessfully) {
                // Defer initialized until state settled
                setTimeout(() => {
                    initializedRef.current = true
                }, 100)
            }
        }
    }

    /**
     * Core save: read from ref, optional override (avoid stale closure)
     * optimistic=true: show saved immediately, rollback only on failure
     */
    const performSave = useCallback(async (overrides?: {
        defaultModels?: DefaultModels
        capabilityDefaults?: CapabilitySelections
    }, optimistic = false) => {
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current)
            saveTimeoutRef.current = null
        }
        if (optimistic) {
            // Match project settings: show saved immediately
            setSaveStatus('saved')
            setTimeout(() => setSaveStatus('idle'), 3000)
        } else {
            setSaveStatus('saving')
        }
        try {
            const currentModels = latestModelsRef.current
            const currentProviders = latestProvidersRef.current
            const currentDefaultModels = overrides?.defaultModels ?? latestDefaultModelsRef.current
            const currentCapabilityDefaults = overrides?.capabilityDefaults ?? latestCapabilityDefaultsRef.current
            const enabledModels = currentModels.filter(m => m.enabled)
            const res = await fetch('/api/user/api-config', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    models: enabledModels,
                    providers: currentProviders,
                    defaultModels: currentDefaultModels,
                    capabilityDefaults: currentCapabilityDefaults,
                }),
            })
            if (res.ok) {
                if (!optimistic) {
                    setSaveStatus('saved')
                    setTimeout(() => setSaveStatus('idle'), 3000)
                }
            } else {
                setSaveStatus('error')
            }
        } catch (error) {
            _ulogError('Save failed:', error)
            setSaveStatus('error')
        }
    }, []) // No deps, all from ref

    // Default model: show saved on select
    // On model switch: first option to capabilityDefaults (unset only)
    const updateDefaultModel = useCallback((
        field: string,
        modelKey: string,
        capabilityFieldsToDefault?: Array<{ field: string; options: CapabilityValue[] }>,
    ) => {
        setDefaultModels(prev => {
            const next = { ...prev, [field]: modelKey }
            latestDefaultModelsRef.current = next

            if (capabilityFieldsToDefault && capabilityFieldsToDefault.length > 0) {
                setCapabilityDefaults(prevCap => {
                    const nextCap: CapabilitySelections = { ...prevCap }
                    const existing = { ...(nextCap[modelKey] || {}) }
                    let changed = false
                    for (const def of capabilityFieldsToDefault) {
                        if (existing[def.field] === undefined && def.options.length > 0) {
                            existing[def.field] = def.options[0]
                            changed = true
                        }
                    }
                    if (changed) {
                        nextCap[modelKey] = existing
                        latestCapabilityDefaultsRef.current = nextCap
                        void performSave({ defaultModels: next, capabilityDefaults: nextCap }, true)
                        return nextCap
                    }
                    void performSave({ defaultModels: next }, true) // optimistic=true
                    return prevCap
                })
            } else {
                void performSave({ defaultModels: next }, true) // optimistic=true
            }
            return next
        })
    }, [performSave])

    const updateCapabilityDefault = useCallback((modelKey: string, field: string, value: string | number | boolean | null) => {
        setCapabilityDefaults((previous) => {
            const next: CapabilitySelections = { ...previous }
            const current = { ...(next[modelKey] || {}) }
            if (value === null) {
                delete current[field]
            } else {
                current[field] = value
            }

            if (Object.keys(current).length === 0) {
                delete next[modelKey]
            } else {
                next[modelKey] = current
            }
            latestCapabilityDefaultsRef.current = next
            void performSave({ capabilityDefaults: next }, true) // optimistic=true
            return next
        })
    }, [performSave])

    // Provider actions
    const updateProviderApiKey = useCallback((providerId: string, apiKey: string) => {
        setProviders(prev => {
            const next = prev.map(p =>
                p.id === providerId ? { ...p, apiKey, hasApiKey: !!apiKey } : p
            )
            latestProvidersRef.current = next
            void performSave(undefined, true)
            return next
        })
    }, [performSave])

    const addProvider = useCallback((provider: Omit<Provider, 'hasApiKey'>) => {
        setProviders(prev => {
            const normalizedProviderId = provider.id.toLowerCase()
            if (prev.some((p) => p.id.toLowerCase() === normalizedProviderId)) {
                alert(t('providerIdExists'))
                return prev
            }
            const newProvider: Provider = { ...provider, hasApiKey: !!provider.apiKey }
            const next = [...prev, newProvider]
            latestProvidersRef.current = next

            const providerKey = getProviderKey(provider.id)
            if (providerKey === 'gemini-compatible') {
                // Refetch after save: server injects Google presets with capabilities
                void performSave(undefined, true).then(() => void fetchConfig())
            } else {
                void performSave(undefined, true)
            }
            return next
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [t, performSave])

    const deleteProvider = useCallback((providerId: string) => {
        if (PRESET_PROVIDERS.find(p => p.id === providerId)) {
            alert(t('presetProviderCannotDelete'))
            return
        }
        if (confirm(t('confirmDeleteProvider'))) {
            setProviders(prev => {
                const next = prev.filter(p => p.id !== providerId)
                latestProvidersRef.current = next
                return next
            })
            setModels(prev => {
                const nextModels = prev.filter(m => m.provider !== providerId)
                setDefaultModels(prevDefaults => {
                    const updates: DefaultModels = { ...prevDefaults }
                    const remainingModelKeys = new Set(nextModels.map(m => m.modelKey))
                        ; (['analysisModel', 'characterModel', 'locationModel', 'storyboardModel', 'editModel', 'videoModel', 'lipSyncModel'] as const)
                            .forEach(field => {
                                const current = updates[field]
                                if (current && !remainingModelKeys.has(current)) {
                                    updates[field] = ''
                                }
                            })
                    latestDefaultModelsRef.current = updates
                    return updates
                })
                latestModelsRef.current = nextModels
                void performSave(undefined, true) // Delete provider: save immediately
                return nextModels
            })
        }
    }, [t, performSave])

    const updateProviderInfo = useCallback((providerId: string, name: string, baseUrl?: string) => {
        setProviders(prev => {
            const next = prev.map(p =>
                p.id === providerId ? { ...p, name, baseUrl } : p
            )
            latestProvidersRef.current = next
            void performSave(undefined, true)
            return next
        })
    }, [performSave])

    const updateProviderBaseUrl = useCallback((providerId: string, baseUrl: string) => {
        setProviders(prev => {
            const next = prev.map(p =>
                p.id === providerId ? { ...p, baseUrl } : p
            )
            latestProvidersRef.current = next
            void performSave(undefined, true)
            return next
        })
    }, [performSave])

    // Model actions
    const toggleModel = useCallback((modelKey: string, providerId?: string) => {
        if (isPresetComingSoonModelKey(modelKey)) {
            return
        }
        setModels(prev => {
            const next = prev.map(m =>
                m.modelKey === modelKey && (providerId ? m.provider === providerId : true)
                    ? { ...m, enabled: !m.enabled }
                    : m
            )
            latestModelsRef.current = next
            void performSave(undefined, true) // Toggle: save immediately
            return next
        })
    }, [performSave])

    const updateModel = useCallback((modelKey: string, updates: Partial<CustomModel>, providerId?: string) => {
        let nextModelKey = ''
        setModels(prev => prev.map(m => {
            if (m.modelKey !== modelKey || (providerId ? m.provider !== providerId : false)) return m
            const mergedProvider = updates.provider ?? m.provider
            const mergedModelId = updates.modelId ?? m.modelId
            nextModelKey = encodeModelKey(mergedProvider, mergedModelId)
            return {
                ...m,
                ...updates,
                provider: mergedProvider,
                modelId: mergedModelId,
                modelKey: nextModelKey,
                name: updates.name ?? m.name,
                price: updates.price ?? m.price,
            }
        }))
        if (nextModelKey && nextModelKey !== modelKey) {
            setDefaultModels(prev => {
                const next = { ...prev }
                    ; (['analysisModel', 'characterModel', 'locationModel', 'storyboardModel', 'editModel', 'videoModel', 'lipSyncModel'] as const)
                        .forEach(field => {
                            if (next[field] === modelKey) next[field] = nextModelKey
                        })
                return next
            })
        }
    }, [])

    const addModel = useCallback((model: Omit<CustomModel, 'enabled'>) => {
        setModels(prev => {
            const next = [
                ...prev,
                {
                    ...model,
                    modelKey: model.modelKey || encodeModelKey(model.provider, model.modelId),
                    price: 0,
                    priceLabel: '--',
                    enabled: true,
                },
            ]
            latestModelsRef.current = next
            void performSave(undefined, true) // Add model: save immediately
            return next
        })
    }, [performSave])

    const deleteModel = useCallback((modelKey: string, providerId?: string) => {
        if (PRESET_MODELS.find((model) => {
            const presetModelKey = encodeModelKey(model.provider, model.modelId)
            return presetModelKey === modelKey && (providerId ? model.provider === providerId : true)
        })) {
            alert(t('presetModelCannotDelete'))
            return
        }
        if (confirm(t('confirmDeleteModel'))) {
            setModels(prev => {
                const nextModels = prev.filter(m =>
                    !(m.modelKey === modelKey && (providerId ? m.provider === providerId : true))
                )
                setDefaultModels(prevDefaults => {
                    const nextDefaults = { ...prevDefaults }
                    const remainingModelKeys = new Set(nextModels.map(m => m.modelKey))
                        ; (['analysisModel', 'characterModel', 'locationModel', 'storyboardModel', 'editModel', 'videoModel', 'lipSyncModel'] as const)
                            .forEach(field => {
                                const current = nextDefaults[field]
                                if (current && !remainingModelKeys.has(current)) {
                                    nextDefaults[field] = ''
                                }
                            })
                    latestDefaultModelsRef.current = nextDefaults
                    return nextDefaults
                })
                latestModelsRef.current = nextModels
                void performSave(undefined, true) // Delete model: save immediately
                return nextModels
            })
        }
    }, [t, performSave])

    // Filter
    const getModelsByType = useCallback((type: CustomModel['type']) => {
        return models.filter(m => m.type === type)
    }, [models])

    return {
        providers,
        models,
        defaultModels,
        capabilityDefaults,
        loading,
        saveStatus,
        updateProviderApiKey,
        updateProviderBaseUrl,
        addProvider,
        deleteProvider,
        updateProviderInfo,
        toggleModel,
        updateModel,
        addModel,
        deleteModel,
        updateDefaultModel,
        updateCapabilityDefault,
        getModelsByType
    }
}
