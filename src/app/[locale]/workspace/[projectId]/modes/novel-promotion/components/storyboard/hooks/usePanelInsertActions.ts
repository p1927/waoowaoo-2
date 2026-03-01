'use client'
import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

import { useCallback, useState } from 'react'
import { useInsertProjectPanel } from '@/lib/query/hooks'
import { waitForTaskResult } from '@/lib/task/client'
import { getErrorMessage, isAbortError, type InsertPanelMutationResult } from './panel-operations-shared'

interface UsePanelInsertActionsProps {
  projectId: string
  onRefresh: () => Promise<void> | void
}

export function usePanelInsertActions({
  projectId,
  onRefresh,
}: UsePanelInsertActionsProps) {
  const t = useTranslations('storyboard')
  const [insertingAfterPanelId, setInsertingAfterPanelId] = useState<string | null>(null)
  const insertPanelMutation = useInsertProjectPanel(projectId)

  const insertPanel = useCallback(async (storyboardId: string, panelId: string, userInput: string) => {
    if (insertingAfterPanelId) return
    setInsertingAfterPanelId(panelId)

    try {
      const data = await insertPanelMutation.mutateAsync({
        storyboardId,
        insertAfterPanelId: panelId,
        userInput,
      })
      const result = (data || {}) as InsertPanelMutationResult
      if (result.async && result.taskId) {
        const taskId = result.taskId
        _ulogInfo(`[Insert Panel] Placeholder #${result.panelNumber} created, generating...`)
        setInsertingAfterPanelId(null)
        await onRefresh()

        ; (async () => {
          try {
            await waitForTaskResult(taskId, {
              intervalMs: 3000,
              timeoutMs: 120000,
            })
            _ulogInfo('[Insert Panel] AI content+image done, refreshing')
          } catch (error: unknown) {
            _ulogError(`[Insert Panel] Task aborted: ${getErrorMessage(error, t('common.unknownError'))}`)
          } finally {
            await onRefresh()
          }
        })()
        return
      }

      await onRefresh()
      setInsertingAfterPanelId(null)
    } catch (error: unknown) {
      if (isAbortError(error)) {
        _ulogInfo('Request interrupted (e.g. refresh)')
        return
      }
      _ulogError('Insert panel failed:', error)
      alert(
        t('messages.insertPanelFailed', {
          error: getErrorMessage(error, t('common.unknownError')),
        }),
      )
      setInsertingAfterPanelId(null)
    }
  }, [insertPanelMutation, insertingAfterPanelId, onRefresh, t])

  return {
    insertingAfterPanelId,
    insertPanel,
  }
}
