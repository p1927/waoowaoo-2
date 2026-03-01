import type { Job } from 'bullmq'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import type { TaskJobData } from '@/lib/task/types'
import { resolveAnalysisModel } from './shot-ai-persist'
import { runShotPromptCompletion } from './shot-ai-prompt-runtime'
import {
  parseShotPromptResponse,
  readRequiredString,
  readText,
  type AnyObj,
} from './shot-ai-prompt-utils'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

export async function handleModifyShotPromptTask(job: Job<TaskJobData>, payload: AnyObj) {
  const currentPrompt = readRequiredString(payload.currentPrompt, 'currentPrompt')
  const currentVideoPrompt = readText(payload.currentVideoPrompt)
  const modifyInstruction = readRequiredString(payload.modifyInstruction, 'modifyInstruction')
  const referencedAssets = Array.isArray(payload.referencedAssets) ? payload.referencedAssets : []
  const novelData = await resolveAnalysisModel(job.data.projectId, job.data.userId)

  const assetDescriptions = referencedAssets
    .map((asset) => {
      if (!asset || typeof asset !== 'object') return ''
      const record = asset as Record<string, unknown>
      const name = readText(record.name).trim()
      const description = readText(record.description).trim()
      if (!name && !description) return ''
      return `${name}(${description})`
    })
    .filter(Boolean)
    .join(', ')
  const userInput = assetDescriptions
    ? `${modifyInstruction}\n\nReferenced asset descriptions: ${assetDescriptions}`
    : modifyInstruction
  const finalPrompt = buildPrompt({
    promptId: PROMPT_IDS.NP_IMAGE_PROMPT_MODIFY,
    locale: job.data.locale,
    variables: {
      prompt_input: currentPrompt,
      video_prompt_input: currentVideoPrompt || 'None',
      user_input: userInput,
    },
  })

  await reportTaskProgress(job, 22, {
    stage: 'ai_modify_shot_prompt_prepare',
    stageLabel: 'Preparing shot prompt modification parameters',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'ai_modify_shot_prompt_prepare')

  const responseText = await runShotPromptCompletion({
    job,
    model: novelData.analysisModel,
    prompt: finalPrompt,
    action: 'ai_modify_shot_prompt',
    streamContextKey: 'ai_modify_shot_prompt',
    streamStepId: 'ai_modify_shot_prompt',
    streamStepTitle: 'Shot prompt modification',
  })
  await assertTaskActive(job, 'ai_modify_shot_prompt_parse')

  const parsed = parseShotPromptResponse(responseText)

  await reportTaskProgress(job, 96, {
    stage: 'ai_modify_shot_prompt_done',
    stageLabel: 'Shot prompt modification completed',
    displayMode: 'detail',
  })

  return {
    success: true,
    modifiedImagePrompt: parsed.imagePrompt,
    modifiedVideoPrompt: parsed.videoPrompt,
    referencedAssets,
  }
}
