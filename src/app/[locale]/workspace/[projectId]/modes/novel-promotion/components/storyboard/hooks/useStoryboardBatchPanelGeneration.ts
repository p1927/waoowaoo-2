'use client'

import { useCallback, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import type { NovelPromotionStoryboard } from '@/types/project'
import type { StoryboardPanel } from './useStoryboardState'
import { getErrorMessage } from './storyboard-panel-asset-utils'

interface UseStoryboardBatchPanelGenerationProps {
  sortedStoryboards: NovelPromotionStoryboard[]
  submittingPanelImageIds: Set<string>
  getTextPanels: (storyboard: NovelPromotionStoryboard) => StoryboardPanel[]
  regeneratePanelImage: (panelId: string, count?: number, force?: boolean) => Promise<void>
  setIsEpisodeBatchSubmitting: (value: boolean) => void
}

export function useStoryboardBatchPanelGeneration({
  sortedStoryboards,
  submittingPanelImageIds,
  getTextPanels,
  regeneratePanelImage,
  setIsEpisodeBatchSubmitting,
}: UseStoryboardBatchPanelGenerationProps) {
  const t = useTranslations('storyboard')
  const runningCount = useMemo(() => {
    return sortedStoryboards.reduce((count, storyboard) => {
      const panels = getTextPanels(storyboard)
      return count + panels.filter((panel) => panel.imageTaskRunning || submittingPanelImageIds.has(panel.id)).length
    }, 0)
  }, [getTextPanels, sortedStoryboards, submittingPanelImageIds])

  const pendingPanelCount = useMemo(() => {
    return sortedStoryboards.reduce((count, storyboard) => {
      const panels = getTextPanels(storyboard)
      return (
        count +
        panels.filter(
          (panel) => !panel.imageUrl && !panel.imageTaskRunning && !submittingPanelImageIds.has(panel.id),
        ).length
      )
    }, 0)
  }, [getTextPanels, sortedStoryboards, submittingPanelImageIds])

  const handleGenerateAllPanels = useCallback(async () => {
    setIsEpisodeBatchSubmitting(true)
    try {
      const panelsToGenerate: string[] = []
      sortedStoryboards.forEach((storyboard) => {
        const panels = getTextPanels(storyboard)
        panels.forEach((panel) => {
          const isTaskRunning =
            Boolean((panel as { imageTaskRunning?: boolean }).imageTaskRunning) ||
            submittingPanelImageIds.has(panel.id)
          if (!panel.imageUrl && !isTaskRunning) {
            panelsToGenerate.push(panel.id)
          }
        })
      })

      if (panelsToGenerate.length === 0) {
        _ulogInfo('[Batch generate] No panels to generate')
        return
      }

      _ulogInfo(`[Batch generate] Start ${panelsToGenerate.length} panels`)

      const concurrencyLimit = 10
      const results: Array<PromiseSettledResult<unknown>> = []
      for (let index = 0; index < panelsToGenerate.length; index += concurrencyLimit) {
        const batch = panelsToGenerate.slice(index, index + concurrencyLimit)
        const currentBatch = Math.floor(index / concurrencyLimit) + 1
        const totalBatches = Math.ceil(panelsToGenerate.length / concurrencyLimit)
        _ulogInfo(`[Batch generate] Batch ${currentBatch}/${totalBatches} (${batch.length})`)

        const batchResults = await Promise.allSettled(
          batch.map((panelId) => regeneratePanelImage(panelId, 1)),
        )
        results.push(...batchResults)

        const completed = Math.min(index + concurrencyLimit, panelsToGenerate.length)
        _ulogInfo(`[Batch generate] Done ${completed}/${panelsToGenerate.length}`)
      }

      const succeeded = results.filter((result) => result.status === 'fulfilled').length
      const failed = results.filter((result) => result.status === 'rejected').length
      _ulogInfo(`[Batch generate] Complete: ${succeeded} ok, ${failed} failed`)

      if (failed > 0) {
        const failedReasons = results
          .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
          .map((result) => result.reason?.message || result.reason)
          .slice(0, 3)
          .join('; ')
        alert(
          t('messages.batchGenerateCompleted', {
            succeeded,
            failed,
            errors: failedReasons || t('common.none'),
          }),
        )
      } else if (succeeded > 0) {
        _ulogInfo(`[Batch generate] All ${succeeded} panels generated`)
      }
    } catch (error: unknown) {
      _ulogError('[Batch generate] Unexpected error:', error)
      alert(
        t('messages.batchGenerateFailed', {
          error: getErrorMessage(error, t('common.unknownError')),
        }),
      )
    } finally {
      setIsEpisodeBatchSubmitting(false)
    }
  }, [getTextPanels, regeneratePanelImage, setIsEpisodeBatchSubmitting, sortedStoryboards, submittingPanelImageIds, t])

  return {
    runningCount,
    pendingPanelCount,
    handleGenerateAllPanels,
  }
}
