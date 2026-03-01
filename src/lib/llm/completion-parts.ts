import OpenAI from 'openai'
import { extractCompletionPartsFromContent } from './utils'
import { _ulogError } from './runtime-shared'

export function getCompletionContent(completion: OpenAI.Chat.Completions.ChatCompletion): string {
  return getCompletionParts(completion).text
}

export function getCompletionParts(completion: OpenAI.Chat.Completions.ChatCompletion): {
  text: string
  reasoning: string
} {
  if (!completion || !completion.choices || completion.choices.length === 0) {
    _ulogError(
      '[LLM] Invalid response - full object:',
      JSON.stringify(completion, null, 2).substring(0, 2000),
    )
    throw new Error('LLM returned invalid response')
  }

  const message = completion.choices[0]?.message
  if (!message) {
    _ulogError(
      '[LLM] Response has no message content - choices[0]:',
      JSON.stringify(completion.choices[0], null, 2).substring(0, 1000),
    )
    throw new Error('LLM response has no message content')
  }

  const content = message.content
  return extractCompletionPartsFromContent(content)
}
