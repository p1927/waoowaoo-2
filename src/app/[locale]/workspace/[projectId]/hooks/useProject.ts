import { logError as _ulogError } from '@/lib/logging/core'
import { useState, useCallback } from 'react'
import { Project } from '@/types/project'

/**
 * Refresh scope
 * - all: project + assets
 * - project: project only
 * - assets: assets only
 */
export type RefreshScope = 'all' | 'project' | 'assets'

/**
 * Refresh mode
 * - full: show loading
 * - silent: no loading
 */
export type RefreshMode = 'full' | 'silent'

/**
 * Refresh options
 */
export interface RefreshOptions {
  scope?: RefreshScope    // default 'all'
  mode?: RefreshMode     // default 'silent'
}

/**
 * Project data hook. V2: single refresh(options); scope/mode control behavior.
 */
export function useProject(projectId: string) {
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const [assetsLoading, setAssetsLoading] = useState(false)

  /**
   * refresh(options). scope: 'all'|'project'|'assets'. mode: 'full'|'silent'.
   */
  const refresh = useCallback(async (options: RefreshOptions = {}) => {
    const { scope = 'all', mode = 'silent' } = options

    // Full mode: show loading
    if (mode === 'full') {
      setLoading(true)
      setError(null)
    }

    // Assets scope: show assetsLoading
    if (scope === 'assets') {
      setAssetsLoading(true)
    }

    try {
      // Fetch project
      if (scope === 'all' || scope === 'project') {
        const res = await fetch(`/api/projects/${projectId}/data`)
        if (!res.ok) {
          const errorData = await res.json()
          throw new Error(errorData.error || 'Failed to load project')
        }
        const data = await res.json()
        setProject(data.project)

        // Full mode: reset assets loaded
        if (mode === 'full') {
          setAssetsLoaded(false)
        }
      }

      // Fetch assets
      if (scope === 'all' || scope === 'assets') {
        const res = await fetch(`/api/projects/${projectId}/assets`)
        if (res.ok) {
          const assets = await res.json()
          setProject(prev => {
            if (!prev?.novelPromotionData) return prev
            return {
              ...prev,
              novelPromotionData: {
                ...prev.novelPromotionData,
                characters: assets.characters || [],
                locations: assets.locations || []
              }
            }
          })
          setAssetsLoaded(true)
        }
      }
    } catch (err: unknown) {
      _ulogError('Refresh error:', err)
      if (mode === 'full') {
        setError(getErrorMessage(err))
      }
      // Silent: do not set error state
    } finally {
      if (mode === 'full') {
        setLoading(false)
      }
      if (scope === 'assets') {
        setAssetsLoading(false)
      }
    }
  }, [projectId])

  /**
   * Update project (optimistic)
   */
  const updateProject = useCallback((updates: Partial<Project>) => {
    setProject(prev => prev ? { ...prev, ...updates } : null)
  }, [])

  return {
    // State
    project,
    loading,
    error,
    assetsLoaded,
    assetsLoading,

    // refresh
    refresh,

    // Optimistic update
    updateProject
  }
}
  const getErrorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message
    return String(err)
  }
