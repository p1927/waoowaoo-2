'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { ContentLocale } from '@/lib/prompt-i18n'

const STORAGE_KEY = 'waoowaoo_content_locale'
const DEFAULT_CONTENT_LOCALE: ContentLocale = 'en'

type ContentLocaleContextValue = {
  contentLocale: ContentLocale
  setContentLocale: (locale: ContentLocale) => void
}

const ContentLocaleContext = createContext<ContentLocaleContextValue>({
  contentLocale: DEFAULT_CONTENT_LOCALE,
  setContentLocale: () => {},
})

function readStoredLocale(): ContentLocale {
  if (typeof window === 'undefined') return DEFAULT_CONTENT_LOCALE
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'en' || stored === 'hi' || stored === 'sa') return stored
  return DEFAULT_CONTENT_LOCALE
}

export function ContentLocaleProvider({ children }: { children: ReactNode }) {
  const [contentLocale, setContentLocaleRaw] = useState<ContentLocale>(DEFAULT_CONTENT_LOCALE)

  useEffect(() => {
    setContentLocaleRaw(readStoredLocale())
  }, [])

  const setContentLocale = useCallback((locale: ContentLocale) => {
    setContentLocaleRaw(locale)
    localStorage.setItem(STORAGE_KEY, locale)
  }, [])

  return (
    <ContentLocaleContext.Provider value={{ contentLocale, setContentLocale }}>
      {children}
    </ContentLocaleContext.Provider>
  )
}

export function useContentLocale() {
  return useContext(ContentLocaleContext)
}
