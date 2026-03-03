import type { Locale } from '@/i18n/routing'
import type { PromptId } from './prompt-ids'

export const contentLocales = ['en', 'hi', 'sa'] as const
export type ContentLocale = (typeof contentLocales)[number]

export type PromptLocale = ContentLocale

export type PromptVariables = Record<string, string>

export type PromptCatalogEntry = {
  pathStem: string
  variableKeys: readonly string[]
}

export type BuildPromptInput = {
  promptId: PromptId
  locale: PromptLocale
  variables?: PromptVariables
}

export function isContentLocale(value: string): value is ContentLocale {
  return (contentLocales as readonly string[]).includes(value)
}
