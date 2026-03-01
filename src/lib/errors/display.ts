import { resolveUnifiedErrorCode } from './codes'
import { getUserMessageByCode } from './user-messages'
import { normalizeAnyError } from './normalize'

export function resolveErrorDisplay(input?: {
  code?: string | null
  message?: string | null
} | null) {
  if (!input) return null
  // When both code and message are empty, no error; return null (otherwise normalizeAnyError would return INTERNAL_ERROR and misreport)
  if (!input.code && !input.message) return null

  const code = resolveUnifiedErrorCode(input.code)
  if (code && code !== 'INTERNAL_ERROR') {
    return {
      code,
      message: getUserMessageByCode(code),
    }
  }

  // When code is fallback INTERNAL_ERROR or missing, infer a more specific code from message for correct display
  const normalized = normalizeAnyError(
    { code: input.code || undefined, message: input.message || undefined },
    { context: 'api' },
  )
  if (normalized?.code) {
    return {
      code: normalized.code,
      message: getUserMessageByCode(normalized.code),
    }
  }

  return null
}
