import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError, getRequestId } from '@/lib/api-errors'
import { submitTask } from '@/lib/task/submitter'
import { resolveRequiredTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_TYPE } from '@/lib/task/types'
import { buildDefaultTaskBillingInfo } from '@/lib/billing'
import { validatePreviewText, validateVoicePrompt } from '@/lib/qwen-voice-design'

/**
 * Voice design API
 * POST /api/novel-promotion/[projectId]/voice-design
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await context.params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const locale = resolveRequiredTaskLocale(request, body)
  const voicePrompt = typeof body.voicePrompt === 'string' ? body.voicePrompt.trim() : ''
  const previewText = typeof body.previewText === 'string' ? body.previewText.trim() : ''
  const preferredName = typeof body.preferredName === 'string' && body.preferredName.trim()
    ? body.preferredName.trim()
    : 'custom_voice'
  const ALLOWED_VOICE_LANGUAGES = ['en', 'hi', 'sa'] as const
  const rawLang = typeof body.language === 'string' ? body.language : 'hi'
  const language = (ALLOWED_VOICE_LANGUAGES as readonly string[]).includes(rawLang) ? rawLang : 'hi'

  const promptValidation = validateVoicePrompt(voicePrompt)
  if (!promptValidation.valid) {
    throw new ApiError('INVALID_PARAMS')
  }
  const textValidation = validatePreviewText(previewText)
  if (!textValidation.valid) {
    throw new ApiError('INVALID_PARAMS')
  }

  const digest = createHash('sha1')
    .update(`${session.user.id}:${projectId}:${voicePrompt}:${previewText}:${preferredName}:${language}`)
    .digest('hex')
    .slice(0, 16)

  const payload = {
    voicePrompt,
    previewText,
    preferredName,
    language,
    displayMode: 'detail' as const}

  const result = await submitTask({
    userId: session.user.id,
    locale,
    requestId: getRequestId(request),
    projectId,
    type: TASK_TYPE.VOICE_DESIGN,
    targetType: 'NovelPromotionProject',
    targetId: projectId,
    payload,
    dedupeKey: `${TASK_TYPE.VOICE_DESIGN}:${digest}`,
    billingInfo: buildDefaultTaskBillingInfo(TASK_TYPE.VOICE_DESIGN, payload)})

  return NextResponse.json(result)
})
