import { logInfo as _ulogInfo } from '@/lib/logging/core'
import type { UnifiedErrorCode } from '@/lib/errors/codes'
import { getUserMessageByCode } from '@/lib/errors/user-messages'
import { normalizeAnyError } from '@/lib/errors/normalize'

/**
 * Check if error is due to fetch abort (e.g. page unload/refresh).
 * Used to avoid showing meaningless errors on refresh.
 */
export function isAbortError(error: unknown): boolean {
    if (!error) return false

    // Check AbortError
    if (error instanceof DOMException && error.name === 'AbortError') {
        return true
    }

    // Check fetch-related error messages
    if (error instanceof Error) {
        const message = error.message.toLowerCase()
        if (
            message.includes('abort') ||
            message.includes('cancelled') ||
            message.includes('canceled') ||
            message.includes('failed to fetch') ||
            message.includes('network request failed') ||
            message.includes('load failed') ||
            message.includes('the operation was aborted')
        ) {
            return true
        }
    }

    // Check TypeError (often network error)
    if (error instanceof TypeError && error.message.includes('fetch')) {
        return true
    }

    return false
}

export function resolveClientError(error: unknown, fallbackCode: UnifiedErrorCode = 'INTERNAL_ERROR'): {
    code: UnifiedErrorCode
    message: string
    rawMessage: string
} {
    const normalized = normalizeAnyError(error, {
        context: 'api',
        fallbackCode,
    })

    return {
        code: normalized.code,
        message: getUserMessageByCode(normalized.code),
        rawMessage: normalized.message,
    }
}

/**
 * Safe error alert; no alert if error is due to page refresh/abort.
 */
export function safeAlert(message: string, error?: unknown): void {
    if (error && isAbortError(error)) {
        _ulogInfo('[Info] Request aborted (likely page refresh):', message)
        return
    }

    if (error) {
        const resolved = resolveClientError(error)
        alert(message || resolved.message)
        return
    }

    alert(message)
}

/**
 * Whether the error should be shown (false if due to page refresh/abort).
 */
export function shouldShowError(error: unknown): boolean {
    return !isAbortError(error)
}
