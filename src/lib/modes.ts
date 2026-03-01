import { ProjectMode } from '@/types/project'

// Re-export ProjectMode for use elsewhere
export type { ProjectMode }

export interface ModeConfig {
  id: ProjectMode
  name: string
  description: string
  icon: string
  color: string
  available: boolean
}

export const PROJECT_MODE: ModeConfig = {
  id: 'novel-promotion',
  name: 'Novel to short video',
  description: 'Generate short videos from novel content',
  icon: 'N',
  color: 'purple',
  available: true
}

// Kept for compatibility
export const PROJECT_MODES: ModeConfig[] = [PROJECT_MODE]

export function getModeConfig(mode: ProjectMode): ModeConfig | undefined {
  return mode === 'novel-promotion' ? PROJECT_MODE : undefined
}
