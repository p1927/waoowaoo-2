import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { getSignedUrl } from '@/lib/cos'
import { executeAiVisionStep } from '@/lib/ai-runtime'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import { resolveAnalysisModel } from './shot-ai-persist'
import type { AnyObj } from './shot-ai-prompt'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function readRequiredString(value: unknown, field: string): string {
  const text = readText(value).trim()
  if (!text) {
    throw new Error(`${field} is required`)
  }
  return text
}

function parseJsonArrayResponse(responseText: string): AnyObj[] {
  let jsonText = responseText.trim()
  jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')
  const firstBracket = jsonText.indexOf('[')
  const lastBracket = jsonText.lastIndexOf(']')
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    throw new Error('JSON array not found in response')
  }
  jsonText = jsonText.substring(firstBracket, lastBracket + 1)
  return JSON.parse(jsonText) as AnyObj[]
}

function parsePanelCharacters(value: string | null): string {
  if (!value) return 'None'
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.length === 0) return 'None'
    return parsed
      .map((item: unknown) => {
        if (typeof item === 'string') return item
        if (!item || typeof item !== 'object') return ''
        const record = item as Record<string, unknown>
        const name = readText(record.name)
        const appearance = readText(record.appearance)
        return appearance ? `${name}（${appearance}）` : name
      })
      .filter(Boolean)
      .join(', ') || 'None'
  } catch {
    return 'None'
  }
}

export async function handleAnalyzeShotVariantsTask(job: Job<TaskJobData>, payload: AnyObj) {
  const panelId = readRequiredString(payload.panelId, 'panelId')
  const novelData = await resolveAnalysisModel(job.data.projectId, job.data.userId)
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    select: {
      id: true,
      panelNumber: true,
      imageUrl: true,
      description: true,
      shotType: true,
      cameraMove: true,
      location: true,
      characters: true,
    },
  })
  if (!panel) throw new Error('Panel not found')
  if (!panel.imageUrl) throw new Error('This shot has no generated image yet, cannot analyze variants')

  const imageUrl = panel.imageUrl.startsWith('images/')
    ? getSignedUrl(panel.imageUrl, 3600)
    : panel.imageUrl
  const charactersInfo = parsePanelCharacters(panel.characters)

  const prompt = buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_SHOT_VARIANT_ANALYSIS,
    locale: job.data.locale,
    variables: {
      panel_description: panel.description || 'None',
      shot_type: panel.shotType || 'Medium shot',
      camera_move: panel.cameraMove || 'Fixed',
      location: panel.location || 'Unknown',
      characters_info: charactersInfo,
    },
  })

  await reportTaskProgress(job, 20, {
    stage: 'analyze_shot_variants_prepare',
    stageLabel: 'Preparing shot variant analysis parameters',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'analyze_shot_variants_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'analyze_shot_variants')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  const responseText = await (async () => {
    try {
      const result = await withInternalLLMStreamCallbacks(
        streamCallbacks,
        async () =>
          await executeAiVisionStep({
            userId: job.data.userId,
            model: novelData.analysisModel,
            prompt,
            imageUrls: [imageUrl],
            reasoning: true,
            projectId: job.data.projectId,
            action: 'analyze_shot_variants',
            meta: {
              stepId: 'analyze_shot_variants',
              stepTitle: 'Shot variant analysis',
              stepIndex: 1,
              stepTotal: 1,
            },
          }),
      )
      return result.text
    } finally {
      await streamCallbacks.flush()
    }
  })()
  await assertTaskActive(job, 'analyze_shot_variants_parse')

  const suggestions = parseJsonArrayResponse(responseText)
  if (!Array.isArray(suggestions) || suggestions.length < 3) {
    throw new Error('Insufficient number of variants generated')
  }

  await reportTaskProgress(job, 96, {
    stage: 'analyze_shot_variants_done',
    stageLabel: 'Shot variant analysis completed',
    displayMode: 'detail',
  })

  return {
    success: true,
    suggestions,
    panelInfo: {
      panelNumber: panel.panelNumber,
      imageUrl,
      description: panel.description,
    },
  }
}
