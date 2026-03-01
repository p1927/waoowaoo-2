/**
 * Primary appearance index value.
 * All logic that distinguishes primary/sub appearances must use this constant, no hardcoded numbers.
 * Sub-appearance indices start at PRIMARY_APPEARANCE_INDEX + 1.
 */
export const PRIMARY_APPEARANCE_INDEX = 0

// Aspect ratio config (all nanobanana-supported ratios, sorted by usage)
export const ASPECT_RATIO_CONFIGS: Record<string, { label: string; isVertical: boolean }> = {
  '16:9': { label: '16:9', isVertical: false },
  '9:16': { label: '9:16', isVertical: true },
  '1:1': { label: '1:1', isVertical: false },
  '3:2': { label: '3:2', isVertical: false },
  '2:3': { label: '2:3', isVertical: true },
  '4:3': { label: '4:3', isVertical: false },
  '3:4': { label: '3:4', isVertical: true },
  '5:4': { label: '5:4', isVertical: false },
  '4:5': { label: '4:5', isVertical: true },
  '21:9': { label: '21:9', isVertical: false },
}

// Option list for config page (derived from ASPECT_RATIO_CONFIGS)
export const VIDEO_RATIOS = Object.entries(ASPECT_RATIO_CONFIGS).map(([value, config]) => ({
  value,
  label: config.label
}))

// Get aspect ratio config
export function getAspectRatioConfig(ratio: string) {
  return ASPECT_RATIO_CONFIGS[ratio] || ASPECT_RATIO_CONFIGS['16:9']
}

export const ANALYSIS_MODELS = [
  { value: 'google/gemini-3-pro-preview', label: 'Gemini 3 Pro' },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
  { value: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { value: 'anthropic/claude-sonnet-4', label: 'Claude Sonnet 4' }
]

export const IMAGE_MODELS = [
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' }
]

// Image model options (full image generation)
export const IMAGE_MODEL_OPTIONS = [
  { value: 'banana', label: 'Banana Pro (FAL)' },
  { value: 'banana-2', label: 'Banana 2 (FAL)' },
  { value: 'gemini-3-pro-image-preview', label: 'Banana (Google)' },
  { value: 'gemini-3-pro-image-preview-batch', label: 'Banana (Google Batch) 50% off' },
  { value: 'doubao-seedream-4-0-250828', label: 'Seedream 4.0' },
  { value: 'doubao-seedream-4-5-251128', label: 'Seedream 4.5' },
  { value: 'imagen-4.0-generate-001', label: 'Imagen 4.0 (Google)' },
  { value: 'imagen-4.0-ultra-generate-001', label: 'Imagen 4.0 Ultra' },
  { value: 'imagen-4.0-fast-generate-001', label: 'Imagen 4.0 Fast' }
]

// Banana model resolution options (for 9-panel storyboard only, single image fixed at 2K)
export const BANANA_RESOLUTION_OPTIONS = [
  { value: '2K', label: '2K (recommended, fast)' },
  { value: '4K', label: '4K (HD, slower)' }
]

// Banana models that support resolution selection
export const BANANA_MODELS = ['banana', 'banana-2', 'gemini-3-pro-image-preview', 'gemini-3-pro-image-preview-batch']

export const VIDEO_MODELS = [
  { value: 'doubao-seedance-1-0-pro-fast-251015', label: 'Seedance 1.0 Pro Fast' },
  { value: 'doubao-seedance-1-0-pro-fast-251015-batch', label: 'Seedance 1.0 Pro Fast (Batch) 50% off' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428', label: 'Seedance 1.0 Lite' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428-batch', label: 'Seedance 1.0 Lite (Batch) 50% off' },
  { value: 'doubao-seedance-1-5-pro-251215', label: 'Seedance 1.5 Pro' },
  { value: 'doubao-seedance-1-5-pro-251215-batch', label: 'Seedance 1.5 Pro (Batch) 50% off' },
  { value: 'doubao-seedance-1-0-pro-250528', label: 'Seedance 1.0 Pro' },
  { value: 'doubao-seedance-1-0-pro-250528-batch', label: 'Seedance 1.0 Pro (Batch) 50% off' },
  { value: 'fal-wan25', label: 'Wan 2.6' },
  { value: 'fal-veo31', label: 'Veo 3.1 Fast' },
  { value: 'fal-sora2', label: 'Sora 2' },
  { value: 'fal-ai/kling-video/v2.5-turbo/pro/image-to-video', label: 'Kling 2.5 Turbo Pro' },
  { value: 'fal-ai/kling-video/v3/standard/image-to-video', label: 'Kling 3 Standard' },
  { value: 'fal-ai/kling-video/v3/pro/image-to-video', label: 'Kling 3 Pro' }
]

// SeeDream batch model list (uses GPU idle time, 50% cost reduction)
export const SEEDANCE_BATCH_MODELS = [
  'doubao-seedance-1-5-pro-251215-batch',
  'doubao-seedance-1-0-pro-250528-batch',
  'doubao-seedance-1-0-pro-fast-251015-batch',
  'doubao-seedance-1-0-lite-i2v-250428-batch',
]

// Models that support audio generation (Seedance 1.5 Pro only, including batch)
export const AUDIO_SUPPORTED_MODELS = ['doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-5-pro-251215-batch']

// First/last frame video models (authoritative source: standards/capabilities; this constant is for static fallback display only)
export const FIRST_LAST_FRAME_MODELS = [
  { value: 'doubao-seedance-1-5-pro-251215', label: 'Seedance 1.5 Pro (first/last frame)' },
  { value: 'doubao-seedance-1-5-pro-251215-batch', label: 'Seedance 1.5 Pro (first/last frame, batch) 50% off' },
  { value: 'doubao-seedance-1-0-pro-250528', label: 'Seedance 1.0 Pro (first/last frame)' },
  { value: 'doubao-seedance-1-0-pro-250528-batch', label: 'Seedance 1.0 Pro (first/last frame, batch) 50% off' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428', label: 'Seedance 1.0 Lite (first/last frame)' },
  { value: 'doubao-seedance-1-0-lite-i2v-250428-batch', label: 'Seedance 1.0 Lite (first/last frame, batch) 50% off' },
  { value: 'veo-3.1-generate-preview', label: 'Veo 3.1 (first/last frame)' },
  { value: 'veo-3.1-fast-generate-preview', label: 'Veo 3.1 Fast (first/last frame)' }
]

export const VIDEO_RESOLUTIONS = [
  { value: '720p', label: '720p' },
  { value: '1080p', label: '1080p' }
]

export const TTS_RATES = [
  { value: '+0%', label: 'Normal speed (1.0x)' },
  { value: '+20%', label: 'Slight speedup (1.2x)' },
  { value: '+50%', label: 'Faster (1.5x)' },
  { value: '+100%', label: 'Fast (2.0x)' }
]

export const TTS_VOICES = [
  { value: 'zh-CN-YunxiNeural', label: 'Yunxi (male)', preview: 'M' },
  { value: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao (female)', preview: 'F' },
  { value: 'zh-CN-YunyangNeural', label: 'Yunyang (male)', preview: 'M' },
  { value: 'zh-CN-XiaoyiNeural', label: 'Xiaoyi (female)', preview: 'F' }
]

export const ART_STYLES = [
  {
    value: 'american-comic',
    label: 'Comic style',
    preview: 'Comic',
    promptEn: 'Japanese anime style'
  },
  {
    value: 'chinese-comic',
    label: 'Premium comic',
    preview: 'CN',
    promptEn: 'Modern premium Chinese comic style, rich details, clean sharp line art, full texture, ultra-clear 2D anime aesthetics.'
  },
  {
    value: 'japanese-anime',
    label: 'Japanese anime',
    preview: 'JP',
    promptEn: 'Modern Japanese anime style, cel shading, clean line art, visual-novel CG look, high-quality 2D style.'
  },
  {
    value: 'realistic',
    label: 'Realistic',
    preview: 'Real',
    promptEn: 'Realistic cinematic look, real-world scene fidelity, rich transparent colors, clean and refined image quality.'
  }
]

/**
 * Get style prompt from ART_STYLES constant (single source of truth).
 *
 * @param artStyle - Style key, e.g. 'realistic', 'american-comic'
 * @param _locale - Unused; kept for API compatibility
 * @returns The style prompt, or empty string if not found
 */
export function getArtStylePrompt(
  artStyle: string | null | undefined,
  _locale?: 'zh' | 'en',
): string {
  void _locale
  if (!artStyle) return ''
  const style = ART_STYLES.find(s => s.value === artStyle)
  if (!style) return ''
  return style.promptEn
}

// Character reference sheet system suffix (appended to prompt, not shown to user): left face close-up + right side three-view
export const CHARACTER_PROMPT_SUFFIX = 'Character reference sheet. Layout: left third = front face close-up (full face for human, most recognizable front for animal/creature); right two-thirds = three-view row (front full, side full, back full), same height. Pure white background, no other elements.'

// Location image system suffix (single scene image; four-view disabled)
export const LOCATION_PROMPT_SUFFIX = ''

// Character image aspect ratio (16:9 landscape, left face + right full body)
export const CHARACTER_IMAGE_RATIO = '16:9'
// Character image size (Seedream API)
export const CHARACTER_IMAGE_SIZE = '3840x2160'  // 16:9 landscape
// Character image ratio (Banana API)
export const CHARACTER_IMAGE_BANANA_RATIO = '3:2'

// Location image aspect ratio (1:1 single scene)
export const LOCATION_IMAGE_RATIO = '1:1'
// Location image size (Seedream API) - 4K
export const LOCATION_IMAGE_SIZE = '4096x4096'  // 1:1 4K
// Location image ratio (Banana API)
export const LOCATION_IMAGE_BANANA_RATIO = '1:1'

// Remove character system suffix from prompt (for user-facing display)
export function removeCharacterPromptSuffix(prompt: string): string {
  if (!prompt) return ''
  return prompt.replace(CHARACTER_PROMPT_SUFFIX, '').trim()
}

// Append character system suffix to prompt (for image generation)
export function addCharacterPromptSuffix(prompt: string): string {
  if (!prompt) return CHARACTER_PROMPT_SUFFIX
  const cleanPrompt = removeCharacterPromptSuffix(prompt)
  return `${cleanPrompt}${cleanPrompt ? ', ' : ''}${CHARACTER_PROMPT_SUFFIX}`
}

// Remove location system suffix from prompt (for user-facing display)
export function removeLocationPromptSuffix(prompt: string): string {
  if (!prompt) return ''
  return prompt.replace(LOCATION_PROMPT_SUFFIX, '').replace(/,\s*$/, '').trim()
}

// Append location system suffix to prompt (for image generation)
export function addLocationPromptSuffix(prompt: string): string {
  // If suffix is empty, return prompt as-is
  if (!LOCATION_PROMPT_SUFFIX) return prompt || ''
  if (!prompt) return LOCATION_PROMPT_SUFFIX
  const cleanPrompt = removeLocationPromptSuffix(prompt)
  return `${cleanPrompt}${cleanPrompt ? ', ' : ''}${LOCATION_PROMPT_SUFFIX}`
}

/**
 * Build character introduction string for AI (maps "I" and names to characters).
 *
 * @param characters - List with name and introduction
 * @returns Formatted character introduction string
 */
export function buildCharactersIntroduction(characters: Array<{ name: string; introduction?: string | null }>): string {
  if (!characters || characters.length === 0) return 'No character introductions'

  const introductions = characters
    .filter(c => c.introduction && c.introduction.trim())
    .map(c => `- ${c.name}: ${c.introduction}`)

  if (introductions.length === 0) return 'No character introductions'

  return introductions.join('\n')
}
