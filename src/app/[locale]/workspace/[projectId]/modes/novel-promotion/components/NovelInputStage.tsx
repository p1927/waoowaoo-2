'use client'

/**
 * Novel promotion - story input stage (Story View)
 * V3.2: minimal UI, script input; assets in asset library
 */

import { useTranslations } from 'next-intl'
import { useState, useRef, useEffect } from 'react'
import '@/styles/animations.css'
import { ART_STYLES, VIDEO_RATIOS } from '@/lib/constants'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import { resolveTaskPresentationState } from '@/lib/task/presentation'
import { AppIcon, RatioPreviewIcon } from '@/components/ui/icons'

/**
 * RatioIcon - ratio preview icon
 */
function RatioIcon({ ratio, size = 24, selected = false }: { ratio: string; size?: number; selected?: boolean }) {
  return <RatioPreviewIcon ratio={ratio} size={size} selected={selected} />
}

/**
 * RatioSelector - ratio dropdown
 */
function RatioSelector({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find(o => o.value === value)

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="glass-input-base px-3 py-2.5 flex w-full items-center justify-between gap-2 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-3">
          <RatioIcon ratio={value} size={20} selected />
          <span className="text-sm text-[var(--glass-text-primary)] font-medium">{selectedOption?.label || value}</span>
        </div>
        <AppIcon name="chevronDown" className={`w-4 h-4 text-[var(--glass-text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown - grid */}
      {isOpen && (
        <div className="glass-surface-modal absolute z-50 mt-1 left-0 right-0 p-3 max-h-60 overflow-y-auto custom-scrollbar" style={{ minWidth: '280px' }}>
          <div className="grid grid-cols-5 gap-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
                className={`flex flex-col items-center gap-1.5 p-2 rounded-lg hover:bg-[var(--glass-bg-muted)]/70 transition-colors ${value === option.value
                  ? 'bg-[var(--glass-tone-info-bg)] shadow-[0_0_0_1px_rgba(79,128,255,0.35)]'
                  : ''
                  }`}
              >
                <RatioIcon ratio={option.value} size={28} selected={value === option.value} />
                <span className={`text-xs ${value === option.value ? 'text-[var(--glass-tone-info-fg)] font-medium' : 'text-[var(--glass-text-secondary)]'}`}>
                  {option.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * StyleSelector - visual style drawer
 */
function StyleSelector({
  value,
  onChange,
  options
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string; preview: string }[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find(o => o.value === value) || options[0]

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="glass-input-base px-3 py-2.5 flex w-full items-center justify-between gap-2 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-lg">{selectedOption.preview}</span>
          <span className="text-sm text-[var(--glass-text-primary)] font-medium">{selectedOption.label}</span>
        </div>
        <AppIcon name="chevronDown" className={`w-4 h-4 text-[var(--glass-text-tertiary)] transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="glass-surface-modal absolute z-50 mt-1 left-0 right-0 p-3">
          <div className="grid grid-cols-2 gap-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setIsOpen(false)
                }}
                className={`flex items-center gap-2 p-3 rounded-lg text-left transition-all ${value === option.value
                  ? 'bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] shadow-[0_0_0_1px_rgba(79,128,255,0.35)]'
                  : 'hover:bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)]'
                  }`}
              >
                <span className="text-lg">{option.preview}</span>
                <span className="font-medium text-sm">{option.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface NovelInputStageProps {
  // Core data
  novelText: string
  // Current episode name
  episodeName?: string
  // Callbacks
  onNovelTextChange: (value: string) => void
  onNext: () => void
  // State
  isSubmittingTask?: boolean
  isSwitchingStage?: boolean
  // Narration toggle
  enableNarration?: boolean
  onEnableNarrationChange?: (enabled: boolean) => void
  // Config - ratio and style
  videoRatio?: string
  artStyle?: string
  onVideoRatioChange?: (value: string) => void
  onArtStyleChange?: (value: string) => void
}

export default function NovelInputStage({
  novelText,
  episodeName,
  onNovelTextChange,
  onNext,
  isSubmittingTask = false,
  isSwitchingStage = false,
  enableNarration = false,
  onEnableNarrationChange,
  videoRatio = '9:16',
  artStyle = 'american-comic',
  onVideoRatioChange,
  onArtStyleChange
}: NovelInputStageProps) {
  const t = useTranslations('novelPromotion')
  const hasContent = novelText.trim().length > 0
  const stageSwitchingState = isSwitchingStage
    ? resolveTaskPresentationState({
      phase: 'processing',
      intent: 'generate',
      resource: 'text',
      hasOutput: false,
    })
    : null

  return (
    <div className="max-w-5xl mx-auto space-y-5">

      {/* Current episode hint - top center */}
      {episodeName && (
        <div className="text-center py-1">
          <div className="text-lg font-semibold text-[var(--glass-text-primary)]">
            {t("storyInput.currentEditing", { name: episodeName })}
          </div>
          <div className="text-sm text-[var(--glass-text-tertiary)] mt-1">{t("storyInput.editingTip")}</div>
        </div>
      )}

      {/* Main input area */}
      <div className="glass-surface-elevated overflow-hidden">
        <div className="p-6">
          {/* Word count */}
          <div className="flex items-center justify-end mb-3">
            <span className="glass-chip glass-chip-neutral text-xs">
              {t("storyInput.wordCount")} {novelText.length}
            </span>
          </div>

          {/* Script textarea */}
          <textarea
            value={novelText}
            onChange={(e) => onNovelTextChange(e.target.value)}
            placeholder={`Enter your script or story...

AI will analyze your text to:
• Detect scene changes
• Extract character dialogue and action
• Generate storyboard script

Example:
Morning light through the curtains. Xiao Ming sits up, rubs his eyes, checks the clock—eight already! He jumps out of bed and hurries to get dressed...`}
            className="glass-textarea-base custom-scrollbar h-80 px-4 py-3 text-base resize-none placeholder:text-[var(--glass-text-tertiary)]"
            disabled={isSubmittingTask || isSwitchingStage}
          />

          {/* Asset library tip */}
          <div className="mt-5 p-4 glass-surface-soft">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 glass-surface-soft rounded-xl flex items-center justify-center flex-shrink-0">
                <AppIcon name="folderCards" className="w-5 h-5 text-[var(--glass-text-secondary)]" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[var(--glass-text-secondary)] mb-1">{t("storyInput.assetLibraryTip.title")}</div>
                <p className="text-sm text-[var(--glass-text-tertiary)] leading-relaxed">
                  {t("storyInput.assetLibraryTip.description")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Aspect ratio and style config */}
      <div className="glass-surface p-6 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Aspect ratio */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--glass-text-muted)] tracking-[0.01em]">{t("storyInput.videoRatio")}</h3>
            <RatioSelector
              value={videoRatio}
              onChange={(value) => onVideoRatioChange?.(value)}
              options={VIDEO_RATIOS}
            />
          </div>

          {/* Visual style */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--glass-text-muted)] tracking-[0.01em]">{t("storyInput.visualStyle")}</h3>
            <StyleSelector
              value={artStyle}
              onChange={(value) => onArtStyleChange?.(value)}
              options={ART_STYLES}
            />
          </div>
        </div>
        <p className="text-xs text-[var(--glass-text-tertiary)] mt-4 text-center">
          {t("storyInput.moreConfig")}
        </p>
      </div>

      {/* Narration toggle + actions */}
      <div className="glass-surface p-6">
        {/* Narration toggle */}
        {onEnableNarrationChange && (
          <div className="glass-surface-soft flex items-center justify-between p-4 rounded-xl mb-6">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--glass-tone-info-bg)] text-[var(--glass-tone-info-fg)] font-semibold text-sm">VO</span>
              <div>
                <div className="font-medium text-[var(--glass-text-primary)]">{t("storyInput.narration.title")}</div>
                <div className="text-xs text-[var(--glass-text-tertiary)]">{t("storyInput.narration.description")}</div>
              </div>
            </div>
            <button
              onClick={() => onEnableNarrationChange(!enableNarration)}
              className={`relative w-14 h-8 rounded-full transition-colors ${enableNarration
                ? 'bg-[var(--glass-accent-from)]'
                : 'bg-[var(--glass-stroke-strong)]'
                }`}
            >
              <span
                className={`absolute top-1 left-1 w-6 h-6 bg-[var(--glass-bg-surface)] rounded-full shadow-sm transition-transform ${enableNarration ? 'translate-x-6' : 'translate-x-0'
                  }`}
              />
            </button>
          </div>
        )}

        {/* Start creating button */}
        <button
          onClick={onNext}
          disabled={!hasContent || isSubmittingTask || isSwitchingStage}
          className="glass-btn-base glass-btn-primary w-full py-4 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
        >
          {isSwitchingStage ? (
            <TaskStatusInline state={stageSwitchingState} className="text-white [&>span]:text-white [&_svg]:text-white" />
          ) : (
            <>
              <span>{t("smartImport.manualCreate.button")}</span>
              <AppIcon name="arrowRight" className="w-5 h-5" />
            </>
          )}
        </button>
        <p className="text-center text-xs text-[var(--glass-text-tertiary)] mt-3">
          {hasContent ? t("storyInput.ready") : t("storyInput.pleaseInput")}
        </p>
      </div>
    </div>
  )
}
