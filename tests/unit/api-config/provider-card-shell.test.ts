import { describe, expect, it } from 'vitest'
import { getCompatibilityLayerBadgeLabel } from '@/app/[locale]/profile/components/api-config/provider-card/ProviderCardShell'

describe('provider card shell compatibility layer badge', () => {
  const t = (key: string): string => {
    if (key === 'compatibilityLayerOpenAI') return 'OpenAI compatible'
    if (key === 'compatibilityLayerGemini') return 'Gemini compatible'
    return key
  }

  it('shows OpenAI compatible layer label for openai-compatible providers', () => {
    expect(getCompatibilityLayerBadgeLabel('openai-compatible:oa-1', t)).toBe('OpenAI compatible')
  })

  it('shows Gemini compatible layer label for gemini-compatible providers', () => {
    expect(getCompatibilityLayerBadgeLabel('gemini-compatible:gm-1', t)).toBe('Gemini compatible')
  })

  it('does not show compatibility label for preset providers', () => {
    expect(getCompatibilityLayerBadgeLabel('google', t)).toBeNull()
    expect(getCompatibilityLayerBadgeLabel('ark', t)).toBeNull()
  })
})
