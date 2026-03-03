'use client'

import { useEffect, useRef, useState } from 'react'
import { useContentLocale } from '@/lib/content-locale'
import type { ContentLocale } from '@/lib/prompt-i18n'
import { AppIcon } from '@/components/ui/icons'

const CONTENT_LANGUAGE_OPTIONS: { value: ContentLocale; label: string; flag: string }[] = [
  { value: 'en', label: 'English', flag: 'EN' },
  { value: 'hi', label: 'Hindi', flag: 'HI' },
  { value: 'sa', label: 'Sanskrit', flag: 'SA' },
]

export default function ContentLanguageSelector() {
  const { contentLocale, setContentLocale } = useContentLocale()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const currentOption = CONTENT_LANGUAGE_OPTIONS.find((o) => o.value === contentLocale)

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Content language"
        aria-expanded={isOpen}
        className="glass-btn-base glass-btn-secondary inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm"
      >
        <AppIcon name="globe" className="h-4 w-4" />
        <span>{currentOption?.flag ?? 'EN'}</span>
        <AppIcon name="chevronDown" className="h-4 w-4 text-[var(--glass-text-tertiary)]" />
      </button>

      {isOpen ? (
        <div className="glass-surface-modal absolute right-0 z-50 mt-2 w-48 rounded-xl p-2">
          <div className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--glass-text-tertiary)]">
            Content Language
          </div>
          {CONTENT_LANGUAGE_OPTIONS.map((option) => {
            const isActive = option.value === contentLocale
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setContentLocale(option.value)
                  setIsOpen(false)
                }}
                className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-[var(--glass-fill-active)] text-[var(--glass-text-primary)]'
                    : 'text-[var(--glass-text-secondary)] hover:bg-[var(--glass-fill-hover)] hover:text-[var(--glass-text-primary)]'
                }`}
              >
                <span className="font-medium">{option.flag}</span>
                <span className="ml-2">{option.label}</span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
