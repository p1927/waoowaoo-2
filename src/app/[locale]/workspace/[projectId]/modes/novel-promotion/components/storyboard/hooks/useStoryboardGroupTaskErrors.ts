'use client'

import { useCallback, useMemo } from 'react'
import { useTaskList } from '@/lib/query/hooks/useTaskStatus'
import { resolveErrorDisplay } from '@/lib/errors/display'
import { useDismissFailedTasks } from '@/lib/query/mutations/task-mutations'

interface UseStoryboardGroupTaskErrorsParams {
  projectId: string
  episodeId: string
}

/**
 * Query panel-level failed tasks from DB, support dismiss.
 * dismiss: API sets task status to 'dismissed', DB is source of truth.
 */
export function useStoryboardGroupTaskErrors({
  projectId,
}: UseStoryboardGroupTaskErrorsParams) {
  const panelFailedTasksQuery = useTaskList({
    projectId,
    targetType: 'NovelPromotionPanel',
    statuses: ['failed'],
    limit: 200,
    enabled: !!projectId,
  })

  const dismissMutation = useDismissFailedTasks(projectId)

  const panelTaskErrorMap = useMemo(() => {
    const map = new Map<string, { taskId: string; message: string }>()
    for (const task of panelFailedTasksQuery.data || []) {
      const display = resolveErrorDisplay(task.error || null)
      if (!display) continue
      if (!map.has(task.targetId)) {
        map.set(task.targetId, { taskId: task.id, message: display.message })
      }
    }
    return map
  }, [panelFailedTasksQuery.data])

  const clearPanelTaskError = useCallback((panelId: string) => {
    const taskIds = (panelFailedTasksQuery.data || [])
      .filter((task) => task.targetId === panelId)
      .map((task) => task.id)
    if (taskIds.length === 0) return
    dismissMutation.mutate(taskIds)
  }, [dismissMutation, panelFailedTasksQuery.data])

  return {
    panelTaskErrorMap,
    clearPanelTaskError,
  }
}
