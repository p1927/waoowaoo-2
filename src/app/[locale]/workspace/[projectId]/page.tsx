'use client'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { useQueryClient } from '@tanstack/react-query'
import Navbar from '@/components/Navbar'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { useProjectData, useEpisodeData } from '@/lib/query/hooks'
import { queryKeys } from '@/lib/query/keys'
import NovelPromotionWorkspace from './modes/novel-promotion/NovelPromotionWorkspace'
import SmartImportWizard, { SplitEpisode } from './modes/novel-promotion/components/SmartImportWizard'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { resolveSelectedEpisodeId } from './episode-selection'

// Valid stage values
const VALID_STAGES = ['config', 'script', 'assets', 'text-storyboard', 'storyboard', 'videos', 'voice', 'editor'] as const
type Stage = typeof VALID_STAGES[number]

interface Episode {
  id: string
  episodeNumber: number
  name: string
  description?: string | null
  novelText?: string | null
  audioUrl?: string | null
  srtContent?: string | null
  createdAt: string
}

type NovelPromotionData = {
  episodes?: Episode[]
  importStatus?: string
}

/**
 * Project detail page - Episode management with sidebar
 */
export default function ProjectDetailPage() {
  const params = useParams<{ projectId?: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  if (!params?.projectId) {
    throw new Error('ProjectDetailPage requires projectId route param')
  }
  if (!searchParams) {
    throw new Error('ProjectDetailPage requires searchParams')
  }
  const projectId = params.projectId
  const t = useTranslations('workspaceDetail')
  const tc = useTranslations('common')

  // Read params from URL
  const urlStage = searchParams.get('stage') as Stage | null
  const urlEpisodeId = searchParams.get('episode') ?? null
  const currentUrlStage = urlStage && VALID_STAGES.includes(urlStage) ? urlStage : null

  // React Query data fetching
  const queryClient = useQueryClient()
  const { data: project, isLoading: loading, error: projectError } = useProjectData(projectId)
  const error = projectError?.message || null

  // View state (UI only)
  const [isGlobalAssetsView, setIsGlobalAssetsView] = useState(false)

  // Update URL params (stage and/or episode)
  const updateUrlParams = useCallback((updates: { stage?: string; episode?: string | null }) => {
    const params = new URLSearchParams(searchParams.toString())
    if (updates.stage !== undefined) {
      params.set('stage', updates.stage)
    }
    if (updates.episode !== undefined) {
      if (updates.episode) {
        params.set('episode', updates.episode)
      } else {
        params.delete('episode')
      }
    }
    router.replace(`/workspace/${projectId}?${params.toString()}`, { scroll: false })
  }, [router, projectId, searchParams])

  // Update stage param in URL (backward compatible)
  const updateUrlStage = useCallback((stage: string) => {
    updateUrlParams({ stage })
  }, [updateUrlParams])

  // Stage state is fully controlled by URL, no longer synced from DB
  // If URL has no stage param, default to 'config'
  // Editor stage temporarily disabled, auto-redirect to videos stage
  const effectiveStage = currentUrlStage === 'editor' ? 'videos' : (currentUrlStage || 'config')

  // Get episode list
  const novelPromotionData = project?.novelPromotionData as NovelPromotionData | undefined
  const episodes = useMemo<Episode[]>(() => {
    const getNum = (name: string) => { const m = name.match(/\d+/); return m ? parseInt(m[0], 10) : Infinity }
    return [...(novelPromotionData?.episodes ?? [])].sort((a, b) => {
      const diff = getNum(a.name) - getNum(b.name)
      return diff !== 0 ? diff : a.name.localeCompare(b.name, 'en')
    })
  }, [novelPromotionData?.episodes])

  // Episode navigation state: single source URL (no local copy)
  const selectedEpisodeId = useMemo(
    () => resolveSelectedEpisodeId(episodes, urlEpisodeId),
    [episodes, urlEpisodeId],
  )

  // Use React Query to fetch episode data
  const { data: currentEpisode } = useEpisodeData(
    projectId,
    !isGlobalAssetsView ? selectedEpisodeId : null
  )

  // Get import status
  const importStatus = novelPromotionData?.importStatus

  // Detect if import wizard should show: no episodes or import in progress
  const isZeroState = episodes.length === 0
  const shouldShowImportWizard = isZeroState || importStatus === 'pending'

  // Initialize URL: when episode invalid/missing, write back default episode
  useEffect(() => {
    if (!project || isGlobalAssetsView || episodes.length === 0) return
    if (urlEpisodeId && episodes.some((episode) => episode.id === urlEpisodeId)) return
    if (selectedEpisodeId) {
      updateUrlParams({ episode: selectedEpisodeId })
    }
  }, [episodes, isGlobalAssetsView, project, selectedEpisodeId, updateUrlParams, urlEpisodeId])

  // Create episode
  const handleCreateEpisode = async (name: string, description?: string) => {
    const res = await fetch(`/api/novel-promotion/${projectId}/episodes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description })
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || t('createFailed'))
    }

    const data = await res.json()
    // Refresh project data to get new episode list
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    // Auto-switch to newly created episode
    setIsGlobalAssetsView(false)
    // Sync to URL
    updateUrlParams({ episode: data.episode.id })
  }

  // Smart import - refresh data on completion (data already saved by SmartImportWizard)
  const handleSmartImportComplete = async (splitEpisodes: SplitEpisode[], triggerGlobalAnalysis?: boolean) => {
    _ulogInfo('[Page] handleSmartImportComplete called, triggerGlobalAnalysis:', triggerGlobalAnalysis)

    try {
      // Refresh project data
      queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })

      // Re-fetch latest episode list after refresh
      const res = await fetch(`/api/projects/${projectId}/data`)
      const data = await res.json()
      // API returns { project: { novelPromotionData: { episodes: [...] } } }
      const newEpisodes = data?.project?.novelPromotionData?.episodes || []
      _ulogInfo('[Page] Fetched new episodes:', newEpisodes.length)

      // If episodes exist, enter first one
      if (newEpisodes.length > 0) {
        // If global analysis needed, switch to assets stage with param
        if (triggerGlobalAnalysis) {
          _ulogInfo('[Page] Triggering global analysis, navigating to assets stage with globalAnalyze=1')
          // Use relative path update, preserve locale
          const params = new URLSearchParams()
          params.set('stage', 'assets')
          params.set('episode', newEpisodes[0].id)
          params.set('globalAnalyze', '1')
          const newUrl = `?${params.toString()}`
          _ulogInfo('[Page] Navigating to:', newUrl)
          router.replace(newUrl, { scroll: false })
        } else {
          _ulogInfo('[Page] No global analysis, only updating episode param')
          updateUrlParams({ episode: newEpisodes[0].id })
        }
      }
    } catch (err: unknown) {
      _ulogError('Refresh failed:', err)
    }
  }

  // Rename episode
  const handleRenameEpisode = async (episodeId: string, newName: string) => {
    const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${episodeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    })

    if (!res.ok) {
      throw new Error(t('renameFailed'))
    }

    // Refresh project data
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    // Refresh episode detail too
    if (selectedEpisodeId) {
      queryClient.invalidateQueries({ queryKey: queryKeys.episodeData(projectId, selectedEpisodeId) })
    }
  }

  // Delete episode
  const handleDeleteEpisode = async (episodeId: string) => {
    const res = await fetch(`/api/novel-promotion/${projectId}/episodes/${episodeId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      throw new Error(t('deleteFailed'))
    }
    // Refresh project data
    queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) })
    // If deleted episode is current, switch to another
    if (episodeId === selectedEpisodeId) {
      const remaining = episodes.filter(ep => ep.id !== episodeId)
      if (remaining.length > 0) {
        updateUrlParams({ episode: remaining[0].id })
      } else {
        updateUrlParams({ episode: null })
      }
    }
  }

  // Select episode
  const handleEpisodeSelect = (episodeId: string) => {
    setIsGlobalAssetsView(false)
    // Sync to URL
    updateUrlParams({ episode: episodeId })
  }

  // Loading state: wait for project and episode data to be ready
  // Condition: loading OR (has episodes but episode data not ready)
  // Exclude: if showing import wizard, no need to wait for episode data
  const isInitializing = loading ||
    (!shouldShowImportWizard && !isGlobalAssetsView && episodes.length > 0 && (!selectedEpisodeId || !currentEpisode)) ||
    (project && !project.novelPromotionData)
  const initLoadingState = resolveTaskPresentationState({
    phase: 'processing',
    intent: 'generate',
    resource: 'text',
    hasOutput: false,
  })

  if (isInitializing) {
    return (
      <div className="glass-page min-h-screen">
        <Navbar />
        <main className="flex items-center justify-center h-[calc(100vh-64px)]">
          <div className="text-[var(--glass-text-secondary)]">{tc('loading')}</div>
        </main>
      </div>
    )
  }

  // Error state
  if (error || !project) {
    return (
      <div className="glass-page min-h-screen">
        <Navbar />
        <main className="container mx-auto px-4 py-8">
          <div className="glass-surface p-6 text-center">
            <p className="text-[var(--glass-tone-danger-fg)] mb-4">{error || t('projectNotFound')}</p>
            <button
              onClick={() => router.push('/workspace')}
              className="glass-btn-base glass-btn-primary px-6 py-2"
            >
              {t('backToWorkspace')}
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="glass-page min-h-screen flex flex-col">
      <Navbar />

      {/* V3 UI: Floating nav replaces old Sidebar */}

      {/* Main content area - full width */}
      <main className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-4 py-8">
          {isGlobalAssetsView && project.novelPromotionData ? (
            // Global assets view (ensure data ready)
            <div>
              <h1 className="text-2xl font-bold text-[var(--glass-text-primary)] mb-6">{t('globalAssets')}</h1>
              <NovelPromotionWorkspace
                project={project}
                projectId={projectId}
                viewMode="global-assets"
                urlStage={effectiveStage}
                onStageChange={updateUrlStage}
              />
            </div>
          ) : shouldShowImportWizard && !isGlobalAssetsView ? (
            // Zero state or importing: show smart import wizard
            <SmartImportWizard
              projectId={projectId}
              onManualCreate={() => handleCreateEpisode(`${t('episode')} 1`)}
              onImportComplete={handleSmartImportComplete}
              importStatus={importStatus}
            />
          ) : selectedEpisodeId && currentEpisode ? (
            // Episode workspace (ensure all data ready)
            <NovelPromotionWorkspace
              project={project}
              projectId={projectId}
              episodeId={selectedEpisodeId}
              episode={currentEpisode}
              viewMode="episode"
              urlStage={effectiveStage}
              onStageChange={updateUrlStage}
              episodes={episodes}
              onEpisodeSelect={handleEpisodeSelect}
              onEpisodeCreate={() => handleCreateEpisode(`${t('episode')} ${episodes.length + 1}`)}
              onEpisodeRename={handleRenameEpisode}
              onEpisodeDelete={handleDeleteEpisode}
            />
          ) : (
            // Loading
            <div className="glass-surface p-8 text-center">
              <div className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)]">
                <TaskStatusInline state={initLoadingState} className="[&>span]:sr-only" />
              </div>
              <h2 className="text-xl font-semibold text-[var(--glass-text-secondary)] mb-2">{tc('loading')}</h2>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
