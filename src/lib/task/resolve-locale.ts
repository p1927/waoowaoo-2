import type { NextRequest } from 'next/server'
import { ApiError } from '@/lib/api-errors'
import { contentLocales, type ContentLocale } from '@/lib/prompt-i18n'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function normalizeCandidate(raw: string): ContentLocale | null {
  const normalized = raw.trim().toLowerCase()
  if (!normalized) return null

  for (const locale of contentLocales) {
    if (normalized === locale || normalized.startsWith(`${locale}-`)) {
      return locale
    }
  }
  return null
}

function readLocaleFromPayload(body?: unknown): ContentLocale | null {
  const payload = toObject(body)
  const meta = toObject(payload.meta)
  const candidates: unknown[] = [meta.locale, payload.locale]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const locale = normalizeCandidate(candidate)
    if (locale) return locale
  }
  return null
}

function readLocaleFromHeader(request: NextRequest): ContentLocale | null {
  const raw = request.headers.get('accept-language') || ''
  if (!raw) return null
  const first = raw.split(',')[0]?.trim() || ''
  if (!first) return null
  return normalizeCandidate(first)
}

export function resolveTaskLocaleFromBody(body?: unknown): ContentLocale | null {
  return readLocaleFromPayload(body)
}

export function resolveTaskLocale(request: NextRequest, body?: unknown): ContentLocale | null {
  const payloadLocale = resolveTaskLocaleFromBody(body)
  if (payloadLocale) return payloadLocale
  return readLocaleFromHeader(request)
}

export function resolveRequiredTaskLocale(request: NextRequest, body?: unknown): ContentLocale {
  const locale = resolveTaskLocale(request, body)
  if (!locale) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'TASK_LOCALE_REQUIRED',
      field: 'meta.locale',
    })
  }
  return locale
}
