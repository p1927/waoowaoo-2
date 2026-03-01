/**
 * Novel promotion stage navigation
 */

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/ui/icons'

interface StageNavigationProps {
  projectId: string  // For building link
  episodeId?: string | null  // Current episode for new-tab open
  currentStage: string
  hasNovelText: boolean  // Has text input (enables voice stage)
  hasAudio: boolean
  hasAssets: boolean
  hasStoryboards: boolean
  hasTextStoryboards: boolean  // Has text storyboards (enables panel)
  hasVideos?: boolean
  hasVoiceLines?: boolean  // Has voice lines
  isDisabled: boolean
  onStageClick: (stage: string) => void
}

export function StageNavigation({
  projectId,
  episodeId,
  currentStage,
  hasNovelText,
  hasAudio,
  hasAssets,
  hasStoryboards,
  hasTextStoryboards,
  hasVideos,
  hasVoiceLines,
  isDisabled,
  onStageClick
}: StageNavigationProps) {
  const t = useTranslations('stages')
  // If currentStage is legacy 'text-storyboard', redirect to 'storyboard'
  const effectiveStage = currentStage === 'text-storyboard' ? 'storyboard' : currentStage

  const stages = [
    { id: 'config', label: t('config'), enabled: true },
    { id: 'assets', label: t('assets'), enabled: hasAudio || hasAssets },
    { id: 'storyboard', label: t('storyboard'), enabled: hasTextStoryboards || hasStoryboards },
    { id: 'videos', label: t('videos'), enabled: hasStoryboards || hasVideos },
    // Voice stage enabled when text input exists
    { id: 'voice', label: t('voice'), enabled: hasNovelText || hasVoiceLines }
  ]

  return (
    <div className="flex items-center justify-center space-x-3 text-sm mt-6">
      {stages.map((stage, index) => {
        const isEnabled = stage.enabled && !isDisabled
        const isCurrent = effectiveStage === stage.id
        // Build URL with episode for new-tab
        const href = episodeId
          ? `/workspace/${projectId}?stage=${stage.id}&episode=${episodeId}`
          : `/workspace/${projectId}?stage=${stage.id}`

        const className = `px-5 py-2.5 rounded-xl transition-all font-medium inline-block ${isCurrent
          ? 'bg-[var(--glass-accent-from)] text-white shadow-md'
          : isEnabled
            ? 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-secondary)] hover:bg-[var(--glass-bg-muted)] cursor-pointer'
            : 'bg-[var(--glass-bg-muted)] text-[var(--glass-text-tertiary)] cursor-not-allowed pointer-events-none'
          }`

        return (
          <div key={stage.id} className="flex items-center space-x-3">
            {isEnabled ? (
              <Link
                href={href}
                onClick={(e) => {
                  // Left click: prevent default, use onStageClick
                  if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    e.preventDefault()
                    onStageClick(stage.id)
                  }
                  // Middle/Ctrl+click: default link, new tab
                }}
                className={className}
              >
                {stage.label}
              </Link>
            ) : (
              <span className={className}>
                {stage.label}
              </span>
            )}
            {index < stages.length - 1 && (
              <AppIcon name="chevronRight" className="w-5 h-5 text-[var(--glass-text-tertiary)]" />
            )}
          </div>
        )
      })}
    </div>
  )
}

