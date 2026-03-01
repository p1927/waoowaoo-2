/**
 * Task Reconciliation — DB ↔ BullMQ state sync
 *
 * Fixes tasks stuck when DB task state and BullMQ job state diverge.
 * Three levels:
 *   1. isJobAlive   — single-task check (used by createTask for dedup)
 *   2. reconcileActiveTasks — batch reconcile (used by watchdog)
 *   3. startTaskWatchdog    — watchdog entry (started in instrumentation.ts)
 */

import { prisma } from '@/lib/prisma'
import { createScopedLogger } from '@/lib/logging/core'
import { TASK_STATUS, TASK_EVENT_TYPE } from './types'
import { publishTaskEvent } from './publisher'
import { rollbackTaskBillingForTask } from './service'
import {
    imageQueue,
    videoQueue,
    voiceQueue,
    textQueue,
} from './queues'

// ────────────────────── Constants ──────────────────────

const ACTIVE_STATUSES = [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING]

/** Watchdog check interval */
const WATCHDOG_INTERVAL_MS = 60_000

/** Processing heartbeat timeout */
const PROCESSING_TIMEOUT_MS = 5 * 60_000

/** Max tasks per reconcile scan */
const RECONCILE_BATCH_SIZE = 200

/** Grace window for terminal state to avoid misclassifying just-finished worker as orphan */
const TERMINAL_RECONCILE_GRACE_MS = 90_000

/** Grace window for missing state to avoid misclassifying createTask→enqueue gap as orphan */
const MISSING_RECONCILE_GRACE_MS = 30_000

// ────────────────────── BullMQ job state checks ──────────────────────

type JobState = 'alive' | 'terminal' | 'missing'

const ALL_QUEUES = [imageQueue, videoQueue, voiceQueue, textQueue]

/**
 * Get real state of a BullMQ job.
 * - alive:    Job exists and can still run (waiting / active / delayed / waiting-children)
 * - terminal: Job exists but finished (completed / failed)
 * - missing:  Job not found in any queue
 */
async function getJobState(taskId: string): Promise<JobState> {
    for (const queue of ALL_QUEUES) {
        try {
            const job = await queue.getJob(taskId)
            if (!job) continue
            const state = await job.getState()
            if (state === 'completed' || state === 'failed') {
                return 'terminal'
            }
            // waiting | active | delayed | waiting-children → still alive
            return 'alive'
        } catch {
            // One queue failure does not affect others
            continue
        }
    }
    return 'missing'
}

/**
 * Check if BullMQ job is still alive.
 * Used by createTask for dedup — if job is dead, do not reuse old active task.
 */
export async function isJobAlive(taskId: string): Promise<boolean> {
    const state = await getJobState(taskId)
    return state === 'alive'
}

// ────────────────────── Orphan task termination ──────────────────────

/**
 * Mark an orphan task as failed and send SSE event to frontend.
 */
async function failOrphanedTask(
    task: {
        id: string
        userId: string
        projectId: string
        episodeId: string | null
        type: string
        targetType: string
        targetId: string
        billingInfo: unknown
    },
    reason: string,
): Promise<boolean> {
    const rollbackResult = await rollbackTaskBillingForTask({
        taskId: task.id,
        billingInfo: task.billingInfo,
    })
    const compensationFailed = rollbackResult.attempted && !rollbackResult.rolledBack
    const errorCode = compensationFailed ? 'BILLING_COMPENSATION_FAILED' : 'RECONCILE_ORPHAN'
    const errorMessage = compensationFailed
        ? `${reason}; billing rollback failed`
        : reason

    const result = await prisma.task.updateMany({
        where: {
            id: task.id,
            status: { in: ACTIVE_STATUSES },
        },
        data: {
            status: TASK_STATUS.FAILED,
            errorCode,
            errorMessage,
            finishedAt: new Date(),
            heartbeatAt: null,
            dedupeKey: null,
        },
    })

    if (result.count > 0) {
        // Emit FAILED event to trigger frontend SSE update and data refresh
        await publishTaskEvent({
            taskId: task.id,
            projectId: task.projectId,
            userId: task.userId,
            type: TASK_EVENT_TYPE.FAILED,
            taskType: task.type,
            targetType: task.targetType,
            targetId: task.targetId,
            episodeId: task.episodeId,
            payload: {
                stage: 'reconciled',
                stageLabel: 'Task auto-recovered',
                message: errorMessage,
                compensationFailed,
            },
            persist: false,
        })
    }

    return result.count > 0
}

// ────────────────────── Batch reconcile ──────────────────────

/**
 * Reconcile all DB active tasks with real BullMQ state.
 * Any task active in DB but terminal/missing in BullMQ is marked failed.
 */
export async function reconcileActiveTasks(): Promise<string[]> {
    const now = Date.now()
    const activeTasks = await prisma.task.findMany({
        where: {
            status: { in: ACTIVE_STATUSES },
        },
        select: {
            id: true,
            userId: true,
            projectId: true,
            episodeId: true,
            type: true,
            targetType: true,
            targetId: true,
            billingInfo: true,
            updatedAt: true,
        },
        orderBy: { createdAt: 'asc' },
        take: RECONCILE_BATCH_SIZE,
    })

    if (activeTasks.length === 0) return []

    const reconciled: string[] = []
    for (const task of activeTasks) {
        const jobState = await getJobState(task.id)
        if (jobState === 'alive') continue
        if (
            jobState === 'terminal'
            && now - task.updatedAt.getTime() < TERMINAL_RECONCILE_GRACE_MS
        ) {
            continue
        }
        if (
            jobState === 'missing'
            && now - task.updatedAt.getTime() < MISSING_RECONCILE_GRACE_MS
        ) {
            continue
        }

        const reason =
            jobState === 'terminal'
                ? 'Queue job already terminated but DB was not updated'
                : 'Queue job missing (likely lost during restart)'

        const failed = await failOrphanedTask(task, reason)
        if (failed) {
            reconciled.push(task.id)
        }
    }

    return reconciled
}

// ────────────────────── Watchdog ──────────────────────

let watchdogTimer: ReturnType<typeof setInterval> | null = null

/**
 * Start task watchdog timer.
 * Each cycle:
 *   1. sweepStaleTasks — processing tasks past heartbeat timeout → failed
 *   2. reconcileActiveTasks — DB active but BullMQ job dead → failed
 */
export function startTaskWatchdog() {
    if (watchdogTimer) return

    const logger = createScopedLogger({ module: 'task.watchdog' })
    logger.info({
        action: 'watchdog.start',
        message: `Task watchdog started (interval: ${WATCHDOG_INTERVAL_MS}ms)`,
    })

    watchdogTimer = setInterval(async () => {
        try {
            // 1. Sweep processing tasks that exceeded heartbeat timeout
            const { sweepStaleTasks } = await import('./service')
            const sweptProcessing = await sweepStaleTasks({
                processingThresholdMs: PROCESSING_TIMEOUT_MS,
            })
            for (const task of sweptProcessing) {
                await publishTaskEvent({
                    taskId: task.id,
                    projectId: task.projectId,
                    userId: task.userId,
                    type: TASK_EVENT_TYPE.FAILED,
                    taskType: task.type,
                    targetType: task.targetType,
                    targetId: task.targetId,
                    episodeId: task.episodeId || null,
                    payload: {
                        stage: 'watchdog_timeout',
                        stageLabel: 'Task timed out',
                        message: task.errorMessage,
                        errorCode: task.errorCode,
                        compensationFailed: task.errorCode === 'BILLING_COMPENSATION_FAILED',
                    },
                    persist: false,
                })
            }

            // 2. Reconcile DB vs BullMQ
            const reconciled = await reconcileActiveTasks()

            const total = sweptProcessing.length + reconciled.length
            if (total > 0) {
                logger.info({
                    action: 'watchdog.cycle',
                    message: `Watchdog: ${sweptProcessing.length} heartbeat-timeout, ${reconciled.length} orphan-reconciled`,
                })
            }
        } catch (error) {
            logger.error({
                action: 'watchdog.error',
                message: 'Watchdog cycle failed',
                error:
                    error instanceof Error
                        ? { name: error.name, message: error.message, stack: error.stack }
                        : { message: String(error) },
            })
        }
    }, WATCHDOG_INTERVAL_MS)
}
