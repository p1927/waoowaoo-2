import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { countWords } from '@/lib/word-count'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { getUserModelConfig } from '@/lib/config-service'
import { createTextMarkerMatcher } from '@/lib/novel-promotion/story-to-script/clip-matching'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'

type EpisodeSplit = {
  number?: number
  title?: string
  summary?: string
  startMarker?: string
  endMarker?: string
  startIndex?: number
  endIndex?: number
}

type SplitResponse = {
  episodes?: EpisodeSplit[]
}

const MAX_EPISODE_SPLIT_ATTEMPTS = 2
const EPISODE_SPLIT_BOUNDARY_SUFFIX = `

[Boundary Constraints]
1. Each episode MUST include both startMarker and endMarker from the original text.
2. Markers must be locatable in the original text; allow punctuation/whitespace differences only.
3. If boundaries cannot be located reliably, return an empty episodes array.`

function cleanJsonStringForParse(input: string): string {
  return input.replace(/"([^"\\]|\\.)*"/g, (match) => {
    return match
      .replace(/(?<!\\)\n/g, '\\n')
      .replace(/(?<!\\)\r/g, '\\r')
      .replace(/(?<!\\)\t/g, '\\t')
  })
}

function parseSplitResponse(aiResponse: string): SplitResponse {
  const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/) || aiResponse.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Failed to parse AI response: missing JSON payload')
  }

  const jsonText = cleanJsonStringForParse(jsonMatch[1] || jsonMatch[0])
  const parsed = JSON.parse(jsonText) as SplitResponse
  if (!parsed || !Array.isArray(parsed.episodes) || parsed.episodes.length === 0) {
    throw new Error('Failed to parse AI response: invalid episodes payload')
  }
  return parsed
}

function readBoundaryMarker(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const marker = value.trim()
  return marker.length > 0 ? marker : null
}

function toValidBoundaryIndex(value: unknown, textLength: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const idx = Math.floor(value)
  if (idx < 0 || idx > textLength) return null
  return idx
}

export async function handleEpisodeSplitTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const projectId = job.data.projectId
  const content = typeof payload.content === 'string' ? payload.content : ''
  if (!content || content.length < 100) {
    throw new Error('Text too short, at least 100 characters required')
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      mode: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }
  if (project.mode !== 'novel-promotion') {
    throw new Error('Not a novel promotion project')
  }

  const novelProject = await prisma.novelPromotionProject.findFirst({
    where: { projectId },
    select: { id: true },
  })
  if (!novelProject) {
    throw new Error('Novel promotion data not found')
  }

  const userConfig = await getUserModelConfig(job.data.userId)
  const analysisModel = userConfig.analysisModel
  if (!analysisModel) {
    throw new Error('Please configure the analysis model in settings first')
  }

  const promptBase = buildPrompt({
    promptId: PROMPT_IDS.NP_EPISODE_SPLIT,
    locale: job.data.locale,
    variables: {
      CONTENT: content,
    },
  })
  const prompt = `${promptBase}${EPISODE_SPLIT_BOUNDARY_SUFFIX}`

  await reportTaskProgress(job, 20, {
    stage: 'episode_split_prepare',
    stageLabel: 'Preparing episode split parameters',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'episode_split_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'episode_split')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)
  type EpisodeOutput = {
    number: number
    title: string
    summary: string
    content: string
    wordCount: number
  }
  let episodes: EpisodeOutput[] | null = null
  let lastError: Error | null = null

  try {
    for (let attempt = 1; attempt <= MAX_EPISODE_SPLIT_ATTEMPTS; attempt += 1) {
      try {
        await assertTaskActive(job, `episode_split_attempt:${attempt}`)
        const completion = await withInternalLLMStreamCallbacks(
          streamCallbacks,
          async () =>
            await executeAiTextStep({
              userId: job.data.userId,
              model: analysisModel,
              messages: [{ role: 'user', content: prompt }],
              temperature: 0.3,
              reasoning: true,
              reasoningEffort: 'high',
              projectId,
              action: 'episode_split',
              meta: {
                stepId: 'episode_split',
                stepAttempt: attempt,
                stepTitle: 'Smart episode split',
                stepIndex: 1,
                stepTotal: 1,
              },
            }),
        )

        const aiResponse = completion.text
        if (!aiResponse) {
          throw new Error('AI returned empty response')
        }

        await reportTaskProgress(job, 60, {
          stage: 'episode_split_parse',
          stageLabel: attempt === 1 ? 'Parsing episode split results' : `Parsing episode split results (retry ${attempt - 1})`,
          displayMode: 'detail',
        })
        await assertTaskActive(job, 'episode_split_parse')

        const splitResult = parseSplitResponse(aiResponse)
        const splitEpisodes = splitResult.episodes || []
        if (splitEpisodes.length === 0) {
          throw new Error('Episode split result is empty')
        }

        await reportTaskProgress(job, 80, {
          stage: 'episode_split_match',
            stageLabel: 'Matching episode content ranges',
          displayMode: 'detail',
        })
        const markerMatcher = createTextMarkerMatcher(content)
        const resolved: EpisodeOutput[] = []
        let searchFrom = 0

        for (let idx = 0; idx < splitEpisodes.length; idx += 1) {
          await assertTaskActive(job, `episode_split_match:${idx + 1}`)
          const ep = splitEpisodes[idx]
          const episodeNumber =
            typeof ep.number === 'number' && Number.isFinite(ep.number) && ep.number > 0
              ? Math.floor(ep.number)
              : null
          if (episodeNumber === null) {
            throw new Error(`episode_${idx + 1} missing valid number`)
          }

          const title = typeof ep.title === 'string' ? ep.title.trim() : ''
          if (!title) {
            throw new Error(`episode_${idx + 1} missing title`)
          }

          const startMarker = readBoundaryMarker(ep.startMarker)
          const endMarker = readBoundaryMarker(ep.endMarker)
          if (!startMarker || !endMarker) {
            throw new Error(`episode_${idx + 1} must provide both startMarker and endMarker`)
          }

          const startMatch = markerMatcher.matchMarker(startMarker, searchFrom)
          if (!startMatch) {
            throw new Error(`episode_${idx + 1} startMarker could not be located`)
          }
          const endMatch = markerMatcher.matchMarker(endMarker, startMatch.endIndex)
          if (!endMatch) {
            throw new Error(`episode_${idx + 1} endMarker could not be located`)
          }

          const rawStartIndex = toValidBoundaryIndex(ep.startIndex, content.length)
          if (rawStartIndex !== null && Math.abs(rawStartIndex - startMatch.startIndex) > 200) {
            throw new Error(`episode_${idx + 1} startIndex deviates too much from marker`)
          }
          const rawEndIndex = toValidBoundaryIndex(ep.endIndex, content.length)
          if (rawEndIndex !== null && Math.abs(rawEndIndex - endMatch.endIndex) > 200) {
            throw new Error(`episode_${idx + 1} endIndex deviates too much from marker`)
          }

          const startPos = startMatch.startIndex
          const endPos = endMatch.endIndex
          if (startPos < searchFrom || endPos <= startPos || endPos > content.length) {
            throw new Error(`episode_${idx + 1} boundary range is invalid`)
          }

          const episodeContent = content.slice(startPos, endPos).trim()
          if (!episodeContent) {
            throw new Error(`episode_${idx + 1} matched content is empty`)
          }

          resolved.push({
            number: episodeNumber,
            title,
            summary: typeof ep.summary === 'string' ? ep.summary : '',
            content: episodeContent,
            wordCount: countWords(episodeContent),
          })
          searchFrom = endPos
        }

        episodes = resolved
        break
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
      }
    }
  } finally {
    await streamCallbacks.flush()
  }

  if (!episodes) {
    throw lastError || new Error('Episode boundary matching failed')
  }

  await reportTaskProgress(job, 96, {
    stage: 'episode_split_done',
    stageLabel: 'Smart episode split completed',
    displayMode: 'detail',
  })

  return {
    success: true,
    episodes,
  }
}
