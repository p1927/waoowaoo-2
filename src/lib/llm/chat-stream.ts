import OpenAI from 'openai'
import { generateText, streamText, type ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { GoogleGenAI } from '@google/genai'
import {
  getProviderConfig,
  getProviderKey,
} from '../api-config'
import type { ChatCompletionOptions, ChatCompletionStreamCallbacks } from './types'
import { extractGoogleParts, extractGoogleUsage, GoogleEmptyResponseError } from './providers/google'
import { buildOpenAIChatCompletion } from './providers/openai-compat'
import {
  buildReasoningAwareContent,
  extractStreamDeltaParts,
  getConversationMessages,
  mapReasoningEffort,
  getSystemPrompt,
} from './utils'
import {
  emitStreamChunk,
  emitStreamStage,
  resolveStreamStepMeta,
} from './stream-helpers'
import {
  completionUsageSummary,
  llmLogger,
  logLlmRawInput,
  logLlmRawOutput,
  recordCompletionUsage,
  resolveLlmRuntimeModel,
} from './runtime-shared'
import { getCompletionParts } from './completion-parts'
import { withStreamChunkTimeout } from './stream-timeout'
import { shouldUseOpenAIReasoningProviderOptions } from './reasoning-capability'

type GoogleModelClient = {
  generateContentStream?: (params: unknown) => Promise<unknown>
}

type GoogleChunk = {
  stream?: AsyncIterable<unknown>
}

type AISdkStreamChunk = {
  type?: string
  text?: string
}

type OpenAIStreamWithFinal = AsyncIterable<unknown> & {
  finalChatCompletion?: () => Promise<OpenAI.Chat.Completions.ChatCompletion>
}

const DEFAULT_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

function isNonVolcengineArk(baseUrl: string | undefined): boolean {
  return !!baseUrl && !baseUrl.includes('volces.com')
}

function normalizeArkModelId(modelId: string, baseUrl: string | undefined): string {
  if (isNonVolcengineArk(baseUrl) && modelId.startsWith('doubao-')) {
    return modelId.slice('doubao-'.length)
  }
  return modelId
}

function supportsArkReasoningEffort(modelId: string): boolean {
  return modelId === 'doubao-seed-1-8-251228'
    || modelId === 'seed-1-8-251228'
    || modelId.startsWith('doubao-seed-2-0-')
    || modelId.startsWith('seed-2-0-')
}

export async function chatCompletionStream(
  userId: string,
  model: string | null | undefined,
  messages: { role: 'user' | 'assistant' | 'system'; content: string }[],
  options: ChatCompletionOptions = {},
  callbacks?: ChatCompletionStreamCallbacks,
): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  const streamStep = resolveStreamStepMeta(options)
  emitStreamStage(callbacks, streamStep, 'submit')
  if (!model) {
    const error = new Error('ANALYSIS_MODEL_NOT_CONFIGURED: Please configure the analysis model in settings first')
    callbacks?.onError?.(error, streamStep)
    throw error
  }

  const selection = await resolveLlmRuntimeModel(userId, model)
  const resolvedModelId = selection.modelId
  const provider = selection.provider
  const providerKey = getProviderKey(provider).toLowerCase()
  const temperature = options.temperature ?? 0.7
  const reasoning = options.reasoning ?? true
  const reasoningEffort = options.reasoningEffort || 'high'
  const projectId =
    typeof options.projectId === 'string' && options.projectId.trim().length > 0
      ? options.projectId.trim()
      : undefined
  logLlmRawInput({
    userId,
    projectId,
    provider: providerKey,
    modelId: resolvedModelId,
    modelKey: selection.modelKey,
    stream: true,
    reasoning,
    reasoningEffort,
    temperature,
    action: options.action,
    messages,
  })

  try {
    if (providerKey === 'google' || providerKey === 'gemini-compatible') {
      const config = await getProviderConfig(userId, provider)
      // gemini-compatible may have custom baseUrl (points to third-party compatible service)
      const googleAiOptions = config.baseUrl
        ? { apiKey: config.apiKey, httpOptions: { baseUrl: config.baseUrl } }
        : { apiKey: config.apiKey }
      const ai = new GoogleGenAI(googleAiOptions)
      const modelClient = (ai as unknown as { models?: GoogleModelClient }).models
      if (!modelClient || typeof modelClient.generateContentStream !== 'function') {
        throw new Error('GOOGLE_STREAM_UNAVAILABLE: google provider does not expose generateContentStream')
      }

      const systemParts = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .filter(Boolean)
      const contents = messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        }))
      const systemInstruction = systemParts.length > 0
        ? { parts: [{ text: systemParts.join('\n') }] }
        : undefined
      const supportsThinkingLevel = resolvedModelId.startsWith('gemini-3')
      const thinkingConfig = (options.reasoning ?? true) && supportsThinkingLevel
        ? { thinkingLevel: options.reasoningEffort || 'high', includeThoughts: true }
        : undefined

      emitStreamStage(callbacks, streamStep, 'streaming', providerKey)
      const stream = await modelClient.generateContentStream({
        model: resolvedModelId,
        contents,
        config: {
          temperature: options.temperature ?? 0.7,
          ...(systemInstruction ? { systemInstruction } : {}),
          ...(thinkingConfig ? { thinkingConfig } : {}),
        },
      })
      const streamChunk = stream as GoogleChunk
      const streamIterable = streamChunk?.stream || (stream as AsyncIterable<unknown>)

      let seq = 1
      let text = ''
      let reasoning = ''
      let lastChunk: unknown = null
      for await (const chunk of withStreamChunkTimeout(streamIterable)) {
        lastChunk = chunk
        const chunkParts = extractGoogleParts(chunk)

        let reasoningDelta = chunkParts.reasoning
        if (reasoningDelta && reasoning && reasoningDelta.startsWith(reasoning)) {
          reasoningDelta = reasoningDelta.slice(reasoning.length)
        }
        if (reasoningDelta) {
          reasoning += reasoningDelta
          emitStreamChunk(callbacks, streamStep, {
            kind: 'reasoning',
            delta: reasoningDelta,
            seq,
            lane: 'reasoning',
          })
          seq += 1
        }

        let textDelta = chunkParts.text
        if (textDelta && text && textDelta.startsWith(text)) {
          textDelta = textDelta.slice(text.length)
        }
        if (textDelta) {
          text += textDelta
          emitStreamChunk(callbacks, streamStep, {
            kind: 'text',
            delta: textDelta,
            seq,
            lane: 'main',
          })
          seq += 1
        }
      }

      const usage = extractGoogleUsage(lastChunk)
      // If text is still empty after stream ends, throw retryable error
      if (!text) {
        throw new GoogleEmptyResponseError('stream_empty')
      }
      const completion = buildOpenAIChatCompletion(
        resolvedModelId,
        buildReasoningAwareContent(text, reasoning),
        usage,
      )
      logLlmRawOutput({
        userId,
        projectId,
        provider: providerKey,
        modelId: resolvedModelId,
        modelKey: selection.modelKey,
        stream: true,
        action: options.action,
        text,
        reasoning,
        usage,
      })
      recordCompletionUsage(resolvedModelId, completion)
      emitStreamStage(callbacks, streamStep, 'completed', providerKey)
      callbacks?.onComplete?.(text, streamStep)
      return completion
    }


    if (providerKey === 'ark') {
      const config = await getProviderConfig(userId, provider)
      const arkModelId = normalizeArkModelId(resolvedModelId, config.baseUrl)
      const client = new OpenAI({
        baseURL: config.baseUrl || DEFAULT_ARK_BASE_URL,
        apiKey: config.apiKey,
      })
      const useReasoning = options.reasoning ?? true
      const extraParams: Record<string, unknown> = {}
      if (supportsArkReasoningEffort(resolvedModelId)) {
        extraParams.reasoning_effort = useReasoning ? (options.reasoningEffort || 'high') : 'minimal'
      } else {
        extraParams.thinking = { type: useReasoning ? 'enabled' : 'disabled' }
      }

      emitStreamStage(callbacks, streamStep, 'streaming', provider)
      const stream = await client.chat.completions.create({
        model: arkModelId,
        messages,
        temperature: options.temperature ?? 0.7,
        max_completion_tokens: 65535,
        stream: true,
        ...extraParams,
      } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)

      let text = ''
      let reasoning = ''
      let seq = 1
      let finalCompletion: OpenAI.Chat.Completions.ChatCompletion | null = null
      for await (const part of withStreamChunkTimeout(stream as AsyncIterable<unknown>)) {
        const { textDelta, reasoningDelta } = extractStreamDeltaParts(part)
        if (reasoningDelta) {
          reasoning += reasoningDelta
          emitStreamChunk(callbacks, streamStep, {
            kind: 'reasoning',
            delta: reasoningDelta,
            seq,
            lane: 'reasoning',
          })
          seq += 1
        }
        if (textDelta) {
          text += textDelta
          emitStreamChunk(callbacks, streamStep, {
            kind: 'text',
            delta: textDelta,
            seq,
            lane: 'main',
          })
          seq += 1
        }
      }

      const finalChatCompletionFn = (stream as OpenAIStreamWithFinal)?.finalChatCompletion
      if (typeof finalChatCompletionFn === 'function') {
        try {
          finalCompletion = await finalChatCompletionFn.call(stream)
          const finalParts = getCompletionParts(finalCompletion)
          if (finalParts.reasoning && finalParts.reasoning !== reasoning) {
            const reasoningDelta = finalParts.reasoning.startsWith(reasoning)
              ? finalParts.reasoning.slice(reasoning.length)
              : finalParts.reasoning
            if (reasoningDelta) {
              emitStreamChunk(callbacks, streamStep, {
                kind: 'reasoning',
                delta: reasoningDelta,
                seq,
                lane: 'reasoning',
              })
              seq += 1
            }
            reasoning = finalParts.reasoning
          }
          if (finalParts.text && finalParts.text !== text) {
            const textDelta = finalParts.text.startsWith(text)
              ? finalParts.text.slice(text.length)
              : finalParts.text
            if (textDelta) {
              emitStreamChunk(callbacks, streamStep, {
                kind: 'text',
                delta: textDelta,
                seq,
                lane: 'main',
              })
              seq += 1
            }
            text = finalParts.text
          }
        } catch {
          // Ignore final aggregation errors and keep streamed content.
        }
      }

      const completion = buildOpenAIChatCompletion(
        resolvedModelId,
        buildReasoningAwareContent(text, reasoning),
        finalCompletion
          ? {
            promptTokens: Number(finalCompletion.usage?.prompt_tokens ?? 0),
            completionTokens: Number(finalCompletion.usage?.completion_tokens ?? 0),
          }
          : undefined,
      )
      logLlmRawOutput({
        userId,
        projectId,
        provider,
        modelId: resolvedModelId,
        modelKey: selection.modelKey,
        stream: true,
        action: options.action,
        text,
        reasoning,
        usage: completionUsageSummary(finalCompletion),
      })
      recordCompletionUsage(resolvedModelId, completion)
      emitStreamStage(callbacks, streamStep, 'completed', provider)
      callbacks?.onComplete?.(text, streamStep)
      return completion
    }

    if (providerKey !== 'ark') {
      const config = await getProviderConfig(userId, provider)
      if (!config.baseUrl) {
        throw new Error(`PROVIDER_BASE_URL_MISSING: ${provider} (llm)`)
      }

      const isOpenRouter = !!config.baseUrl?.includes('openrouter')
      const providerName = isOpenRouter ? 'openrouter' : provider
      const shouldUseAiSdk = !isOpenRouter
      if (shouldUseAiSdk) {
        const aiOpenAI = createOpenAI({
          baseURL: config.baseUrl,
          apiKey: config.apiKey,
          name: providerName,
        })
        // Only pass reasoning provider options for providers that support them (e.g. OpenAI, deepseek-r1)
        // gemini-compatible and other OAI-compat providers do not support forceReasoning/reasoningEffort and may return empty
        const isNativeOpenAIReasoning = shouldUseOpenAIReasoningProviderOptions({
          providerKey,
          providerApiMode: config.apiMode,
          modelId: resolvedModelId,
        })
        const aiSdkProviderOptions = (options.reasoning ?? true) && isNativeOpenAIReasoning
          ? {
            openai: {
              reasoningEffort: mapReasoningEffort(options.reasoningEffort || 'high'),
              forceReasoning: true,
            },
          }
          : undefined
        const useReasoning = options.reasoning ?? true
        const aiStreamResult = streamText({
          model: aiOpenAI.chat(resolvedModelId),
          system: getSystemPrompt(messages),
          messages: getConversationMessages(messages),
          // Reasoning models do not support temperature; only pass in non-reasoning mode
          ...(useReasoning ? {} : { temperature: options.temperature ?? 0.7 }),
          maxRetries: options.maxRetries ?? 2,
          ...(aiSdkProviderOptions ? { providerOptions: aiSdkProviderOptions } : {}),
        })


        emitStreamStage(callbacks, streamStep, 'streaming', providerName)
        let text = ''
        let reasoning = ''
        let seq = 1
        // For diagnostics: count each chunk type
        const chunkTypeCounts: Record<string, number> = {}
        // Collect raw API error chunks if any
        const streamErrorChunks: unknown[] = []
        // Record finishReason
        let streamFinishReason: string | undefined
        // Record raw content of unknown chunk types (diagnostics for unparsed AI SDK response)
        const unknownChunkSamples: unknown[] = []
        for await (const chunk of withStreamChunkTimeout(aiStreamResult.fullStream as AsyncIterable<AISdkStreamChunk>)) {
          const chunkType = chunk?.type || 'unknown'
          chunkTypeCounts[chunkType] = (chunkTypeCounts[chunkType] || 0) + 1
          if (chunkType === 'reasoning-delta' && typeof chunk.text === 'string' && chunk.text) {
            reasoning += chunk.text
            emitStreamChunk(callbacks, streamStep, {
              kind: 'reasoning',
              delta: chunk.text,
              seq,
              lane: 'reasoning',
            })
            seq += 1
          }
          if (chunkType === 'text-delta' && typeof chunk.text === 'string' && chunk.text) {
            text += chunk.text
            emitStreamChunk(callbacks, streamStep, {
              kind: 'text',
              delta: chunk.text,
              seq,
              lane: 'main',
            })
            seq += 1
          }
          // Capture error-type chunks (raw API errors)
          if (chunkType === 'error') {
            streamErrorChunks.push((chunk as Record<string, unknown>).error ?? chunk)
          }
          // Capture finishReason from finish-step
          if (chunkType === 'finish-step' || chunkType === 'finish') {
            const reason = (chunk as Record<string, unknown>).finishReason as string | undefined
            if (reason) streamFinishReason = reason
          }
          // Record raw content of non-lifecycle chunks
          const lifecycleTypes = new Set(['text-delta', 'reasoning-delta', 'start', 'start-step', 'finish-step', 'finish', 'error'])
          if (!lifecycleTypes.has(chunkType) && unknownChunkSamples.length < 5) {
            unknownChunkSamples.push(chunk)
          }
        }

        // Read AI SDK warnings (e.g. temperature unsupported) and final finishReason
        let sdkWarnings: unknown[] = []
        let sdkFinishReason: string | undefined
        let sdkProviderMetadata: unknown = undefined
        let sdkResponseStatus: number | undefined
        let sdkResponseHeaders: Record<string, string> | undefined
        try {
          const warnResult = await Promise.resolve(aiStreamResult.warnings).catch(() => null)
          sdkWarnings = Array.isArray(warnResult) ? warnResult : []
        } catch { }
        try {
          sdkFinishReason = await Promise.resolve(aiStreamResult.finishReason).catch(() => undefined) as string | undefined
        } catch { }
        // Read providerMetadata (Gemini safetyRatings etc. for diagnostics)
        try {
          sdkProviderMetadata = await Promise.resolve((aiStreamResult as unknown as { experimental_providerMetadata?: unknown }).experimental_providerMetadata).catch(() => undefined)
        } catch { }
        // Read HTTP response status (diagnose API-level success)
        try {
          const resp = await Promise.resolve(aiStreamResult.response).catch(() => null)
          if (resp) {
            sdkResponseStatus = (resp as { status?: number }).status
            const hdrs = (resp as { headers?: Record<string, string> }).headers
            if (hdrs && typeof hdrs === 'object') {
              sdkResponseHeaders = Object.fromEntries(
                Object.entries(hdrs).filter(([k]) => ['content-type', 'x-ratelimit-remaining-requests', 'x-request-id'].includes(k))
              ) as Record<string, string>
            }
          }
        } catch { }

        let finalReasoning = reasoning
        let finalText = text
        try {
          const resolvedReasoning = await aiStreamResult.reasoningText
          if (resolvedReasoning && resolvedReasoning !== finalReasoning) {
            const delta = resolvedReasoning.startsWith(finalReasoning)
              ? resolvedReasoning.slice(finalReasoning.length)
              : resolvedReasoning
            if (delta) {
              emitStreamChunk(callbacks, streamStep, {
                kind: 'reasoning',
                delta,
                seq,
                lane: 'reasoning',
              })
              seq += 1
            }
            finalReasoning = resolvedReasoning
          }
        } catch { }
        try {
          const resolvedText = await aiStreamResult.text
          if (resolvedText && resolvedText !== finalText) {
            const delta = resolvedText.startsWith(finalText)
              ? resolvedText.slice(finalText.length)
              : resolvedText
            if (delta) {
              emitStreamChunk(callbacks, streamStep, {
                kind: 'text',
                delta,
                seq,
                lane: 'main',
              })
              seq += 1
            }
            finalText = resolvedText
          }
        } catch { }

        let usage = await Promise.resolve(aiStreamResult.usage).catch(() => null)

        // Explicit fallback: when reasoning options return empty text, retry once without reasoning provider options.
        if (!finalText && aiSdkProviderOptions) {
          llmLogger.warn({
            audit: false,
            action: 'llm.stream.reasoning_fallback',
            message: '[LLM] empty stream with reasoning options, retrying once without provider reasoning options',
            userId,
            projectId,
            provider: providerName,
            details: {
              model: { id: resolvedModelId, key: selection.modelKey },
              action: options.action ?? null,
              finishReason: sdkFinishReason ?? streamFinishReason ?? 'unknown',
            },
          })

          try {
            const fallbackResult = await generateText({
              model: aiOpenAI.chat(resolvedModelId),
              system: getSystemPrompt(messages),
              messages: getConversationMessages(messages) as ModelMessage[],
              temperature: options.temperature ?? 0.7,
              maxRetries: options.maxRetries ?? 2,
            })
            const fallbackReasoning = fallbackResult.reasoningText || ''
            const fallbackText = fallbackResult.text || ''
            const fallbackUsage = fallbackResult.usage || fallbackResult.totalUsage

            if (fallbackReasoning) {
              emitStreamChunk(callbacks, streamStep, {
                kind: 'reasoning',
                delta: fallbackReasoning,
                seq,
                lane: 'reasoning',
              })
              seq += 1
            }
            if (fallbackText) {
              emitStreamChunk(callbacks, streamStep, {
                kind: 'text',
                delta: fallbackText,
                seq,
                lane: 'main',
              })
              seq += 1
            }

            if (fallbackReasoning) finalReasoning = fallbackReasoning
            if (fallbackText) finalText = fallbackText
            if (fallbackUsage) usage = fallbackUsage
          } catch (fallbackError) {
            llmLogger.warn({
              audit: false,
              action: 'llm.stream.reasoning_fallback_failed',
              message: '[LLM] fallback without reasoning options failed',
              userId,
              projectId,
              provider: providerName,
              details: {
                model: { id: resolvedModelId, key: selection.modelKey },
                action: options.action ?? null,
                error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
              },
            })
          }
        }

        // Empty response diagnostics: log details and throw retryable error when text is empty
        if (!finalText) {
          // Sync log to avoid race and include full raw API error
          llmLogger.warn({
            audit: false,
            action: 'llm.stream.empty_response',
            message: '[LLM] AI SDK stream returned empty content',
            userId,
            projectId,
            provider: providerName,
            details: {
              model: { id: resolvedModelId, key: selection.modelKey },
              action: options.action ?? null,
              reasoningEnabled: useReasoning,
              isNativeOpenAIReasoning,
              reasoningEffort: options.reasoningEffort ?? 'high',
              chunkTypeCounts,
              sdkWarnings,
              // Raw API error chunks
              streamErrors: streamErrorChunks.length > 0 ? streamErrorChunks : undefined,
              // finish reason (e.g. error / content-filter / stop / other)
              finishReason: sdkFinishReason ?? streamFinishReason ?? 'unknown',
              // providerMetadata: Gemini safetyRatings, blockReason, etc.
              providerMetadata: sdkProviderMetadata,
              // HTTP response status (diagnose API-level success)
              httpStatus: sdkResponseStatus,
              httpHeaders: sdkResponseHeaders,
              // Raw content of chunks not recognized by AI SDK (model may have returned special format)
              unknownChunks: unknownChunkSamples.length > 0 ? unknownChunkSamples : undefined,
              streamedReasoningLength: finalReasoning.length,
            },
          })
          const finishInfo = sdkFinishReason ?? streamFinishReason ?? 'unknown'
          const errDetail = streamErrorChunks.length > 0
            ? ` [apiError: ${JSON.stringify(streamErrorChunks[0])}]`
            : sdkWarnings.length > 0 ? ` [warnings: ${JSON.stringify(sdkWarnings)}]` : ''
          throw new Error(
            `LLM_EMPTY_RESPONSE: ${providerName}::${resolvedModelId} returned empty content` +
            ` [finishReason: ${finishInfo}]` +
            ` [httpStatus: ${sdkResponseStatus ?? 'unknown'}]` +
            errDetail +
            ` [chunks: ${JSON.stringify(chunkTypeCounts)}]`,
          )
        }





        const completion = buildOpenAIChatCompletion(
          resolvedModelId,
          buildReasoningAwareContent(finalText, finalReasoning),
          {
            promptTokens: usage?.inputTokens ?? 0,
            completionTokens: usage?.outputTokens ?? 0,
          },
        )
        logLlmRawOutput({
          userId,
          projectId,
          provider: providerName,
          modelId: resolvedModelId,
          modelKey: selection.modelKey,
          stream: true,
          action: options.action,
          text: finalText,
          reasoning: finalReasoning,
          usage: {
            promptTokens: usage?.inputTokens ?? 0,
            completionTokens: usage?.outputTokens ?? 0,
          },
        })
        recordCompletionUsage(resolvedModelId, completion)
        emitStreamStage(callbacks, streamStep, 'completed', providerName)
        callbacks?.onComplete?.(finalText, streamStep)
        return completion
      }

      const client = new OpenAI({
        baseURL: config.baseUrl,
        apiKey: config.apiKey,
      })

      const extraParams: Record<string, unknown> = {}
      if (isOpenRouter && (options.reasoning ?? true)) {
        extraParams.reasoning = { effort: options.reasoningEffort || 'high' }
      }

      emitStreamStage(callbacks, streamStep, 'streaming', providerName)
      const isOpenRouterReasoning = isOpenRouter && (options.reasoning ?? true)
      const stream = await client.chat.completions.create({
        model: resolvedModelId,
        messages,
        // OpenRouter reasoning models do not support temperature
        ...(isOpenRouterReasoning ? {} : { temperature: options.temperature ?? 0.7 }),
        stream: true,
        ...extraParams,
      } as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming)

      let text = ''
      let reasoning = ''
      let seq = 1
      let finalCompletion: OpenAI.Chat.Completions.ChatCompletion | null = null
      for await (const part of withStreamChunkTimeout(stream as AsyncIterable<unknown>)) {
        const { textDelta, reasoningDelta } = extractStreamDeltaParts(part)
        if (reasoningDelta) {
          reasoning += reasoningDelta
          emitStreamChunk(callbacks, streamStep, {
            kind: 'reasoning',
            delta: reasoningDelta,
            seq,
            lane: 'reasoning',
          })
          seq += 1
        }
        if (textDelta) {
          text += textDelta
          emitStreamChunk(callbacks, streamStep, {
            kind: 'text',
            delta: textDelta,
            seq,
            lane: 'main',
          })
          seq += 1
        }
      }

      const finalChatCompletionFn = (stream as OpenAIStreamWithFinal)?.finalChatCompletion
      if (typeof finalChatCompletionFn === 'function') {
        try {
          finalCompletion = await finalChatCompletionFn.call(stream)
          const finalParts = getCompletionParts(finalCompletion)
          if (finalParts.reasoning && finalParts.reasoning !== reasoning) {
            const reasoningDelta = finalParts.reasoning.startsWith(reasoning)
              ? finalParts.reasoning.slice(reasoning.length)
              : finalParts.reasoning
            if (reasoningDelta) {
              emitStreamChunk(callbacks, streamStep, {
                kind: 'reasoning',
                delta: reasoningDelta,
                seq,
                lane: 'reasoning',
              })
              seq += 1
            }
            reasoning = finalParts.reasoning
          }
          if (finalParts.text && finalParts.text !== text) {
            const textDelta = finalParts.text.startsWith(text)
              ? finalParts.text.slice(text.length)
              : finalParts.text
            if (textDelta) {
              emitStreamChunk(callbacks, streamStep, {
                kind: 'text',
                delta: textDelta,
                seq,
                lane: 'main',
              })
              seq += 1
            }
            text = finalParts.text
          }
        } catch {
          // Ignore final aggregation errors and keep streamed content.
        }
      }

      const completion = buildOpenAIChatCompletion(
        resolvedModelId,
        buildReasoningAwareContent(text, reasoning),
        finalCompletion
          ? {
            promptTokens: Number(finalCompletion.usage?.prompt_tokens ?? 0),
            completionTokens: Number(finalCompletion.usage?.completion_tokens ?? 0),
          }
          : undefined,
      )
      logLlmRawOutput({
        userId,
        projectId,
        provider: providerName,
        modelId: resolvedModelId,
        modelKey: selection.modelKey,
        stream: true,
        action: options.action,
        text,
        reasoning,
        usage: completionUsageSummary(finalCompletion),
      })
      recordCompletionUsage(resolvedModelId, completion)
      emitStreamStage(callbacks, streamStep, 'completed', providerName)
      callbacks?.onComplete?.(text, streamStep)
      return completion
    }
    throw new Error(`UNSUPPORTED_STREAM_PROVIDER: ${providerKey}`)
  } catch (error) {
    // Detect PROHIBITED_CONTENT from Gemini and normalize to SENSITIVE_CONTENT
    // (consistent with chat-completion.ts)
    const errMsg = error instanceof Error ? error.message : String(error)
    if (errMsg.includes('PROHIBITED_CONTENT') || errMsg.includes('request_body_blocked')) {
      const sensitiveError = new Error('SENSITIVE_CONTENT: Content contains sensitive material and cannot be processed. Please modify and retry.')
      callbacks?.onError?.(sensitiveError, streamStep)
      throw sensitiveError
    }
    callbacks?.onError?.(error, streamStep)
    throw error
  }
}
