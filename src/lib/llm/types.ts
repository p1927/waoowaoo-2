import type { LLMStreamKind } from '@/lib/llm-observe/types'
import type { InternalLLMStreamStepMeta } from '@/lib/llm-observe/internal-stream-context'

export interface ChatCompletionOptions {
    temperature?: number
    reasoning?: boolean
    reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high'
    maxRetries?: number
    // Billing
    projectId?: string   // For billing (default 'system' if not set)
    action?: string     // Billing action name
    // Stream step metadata (for task console step display)
    streamStepId?: string
    streamStepAttempt?: number
    streamStepTitle?: string
    streamStepIndex?: number
    streamStepTotal?: number
    // Internal guard: prevent chatCompletion and chatCompletionStream from recursing
    __skipAutoStream?: boolean
}

export interface ChatCompletionStreamCallbacks {
    onStage?: (stage: {
        stage: 'submit' | 'streaming' | 'fallback' | 'completed'
        provider?: string | null
        step?: InternalLLMStreamStepMeta
    }) => void
    onChunk?: (chunk: {
        kind: LLMStreamKind
        delta: string
        seq: number
        lane?: string | null
        step?: InternalLLMStreamStepMeta
    }) => void
    onComplete?: (text: string, step?: InternalLLMStreamStepMeta) => void
    onError?: (error: unknown, step?: InternalLLMStreamStepMeta) => void
}

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string }
