import { createScopedLogger } from '@/lib/logging/core'
import COS from 'cos-nodejs-sdk-v5'
import * as fs from 'fs/promises'
import * as path from 'path'
import { decodeImageUrlsFromDb } from '@/lib/contracts/image-urls-contract'
import { normalizeToBase64ForGeneration } from '@/lib/media/outbound-image'

const cosLogger = createScopedLogger({
  module: 'storage.cos',
})
const _ulogInfo = (...args: unknown[]) => cosLogger.info(...args)
const _ulogWarn = (...args: unknown[]) => cosLogger.warn(...args)
const _ulogError = (...args: unknown[]) => cosLogger.error(...args)

// ==================== Storage type config ====================
// STORAGE_TYPE: 'cos' | 'local'
// - cos: Tencent Cloud COS (requires COS_SECRET_ID etc.)
// - local: Local file storage (for intranet deployment)
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'cos'
const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads'

// Log identifier
const isLocalStorage = STORAGE_TYPE === 'local'
if (isLocalStorage) {
  _ulogInfo(`[Storage] Using local storage mode, directory: ${UPLOAD_DIR}`)
} else {
  _ulogInfo(`[Storage] Using COS cloud storage mode`)
}

// COS timeout and retry config
const COS_TIMEOUT_MS = 60 * 1000  // 60 second timeout
const COS_MAX_RETRIES = 3         // Max retries
const COS_RETRY_DELAY_BASE_MS = 2000  // Retry delay base
// Unified signed URL expiry: 24 hours
const SIGNED_URL_EXPIRES_SECONDS = 24 * 60 * 60

type UnknownRecord = Record<string, unknown>

interface AppLike {
  imageUrls: string | null
  descriptions: string | unknown[] | null
  imageUrl: string | null
  [key: string]: unknown
}

interface CharacterLike {
  appearances?: AppLike[]
  customVoiceUrl?: string | null
  [key: string]: unknown
}

interface LocationImageLike {
  imageUrl: string | null
  [key: string]: unknown
}

interface LocationLike {
  images?: LocationImageLike[]
  [key: string]: unknown
}

interface ShotLike {
  imageUrl: string | null
  videoUrl: string | null
  [key: string]: unknown
}

interface PanelLike {
  imageUrl: string | null
  sketchImageUrl: string | null
  videoUrl: string | null
  lipSyncVideoUrl: string | null
  candidateImages: string | null
  panelImageHistory?: string | null
  imageHistory?: string | null
  [key: string]: unknown
}

interface StoryboardLike {
  panels?: PanelLike[]
  imageHistory?: string | null
  storyboardImageUrl: string | null
  [key: string]: unknown
}

interface ProjectLike {
  audioUrl?: string | null
  characters?: CharacterLike[]
  locations?: LocationLike[]
  shots?: ShotLike[]
  storyboards?: StoryboardLike[]
  [key: string]: unknown
}

function extractErrorInfo(error: unknown): { name?: string; code?: string; message: string; cause?: unknown } {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown; cause?: unknown }
    return {
      name: error.name,
      code: typeof withCode.code === 'string' ? withCode.code : undefined,
      message: error.message,
      cause: withCode.cause,
    }
  }
  if (error && typeof error === 'object') {
    const record = error as UnknownRecord
    return {
      name: typeof record.name === 'string' ? record.name : undefined,
      code: typeof record.code === 'string' ? record.code : undefined,
      message: typeof record.message === 'string' ? record.message : String(error),
      cause: record.cause,
    }
  }
  return { message: String(error) }
}

export function toFetchableUrl(inputUrl: string): string {
  if (inputUrl.startsWith('http://') || inputUrl.startsWith('https://') || inputUrl.startsWith('data:')) {
    return inputUrl
  }
  if (inputUrl.startsWith('/')) {
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    return `${baseUrl}${inputUrl}`
  }
  return inputUrl
}

// COS client (initialized only in COS mode)
let cos: COS | null = null
let BUCKET = ''
let REGION = ''

if (!isLocalStorage) {
  cos = new COS({
    SecretId: process.env.COS_SECRET_ID!,
    SecretKey: process.env.COS_SECRET_KEY!,
    Timeout: COS_TIMEOUT_MS,
  })
  BUCKET = process.env.COS_BUCKET!
  REGION = process.env.COS_REGION!
}

/**
 * Get COS client instance (COS mode only)
 */
export function getCOSClient() {
  if (isLocalStorage) {
    throw new Error('COS client not available in local storage mode')
  }
  return cos!
}

/**
 * Upload file to storage (COS or local filesystem)
 * @param buffer File buffer
 * @param key File path (e.g. images/character-xxx.png)
 * @param maxRetries Max retries, default 3
 * @returns Storage key
 */
export async function uploadToCOS(buffer: Buffer, key: string, maxRetries: number = COS_MAX_RETRIES): Promise<string> {
  // ==================== Local storage mode ====================
  if (isLocalStorage) {
    try {
      const filePath = path.join(UPLOAD_DIR, key)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, buffer)
      _ulogInfo(`[Local Upload] Success: ${key}`)
      return key
    } catch (error: unknown) {
      const errorInfo = extractErrorInfo(error)
      _ulogError(`[Local Upload] Failed: ${key}`, errorInfo.message)
      throw new Error(`Local storage upload failed: ${key}`)
    }
  }

  // ==================== COS cloud storage mode ====================
  let lastError: unknown = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        _ulogInfo(`[COS Upload] Attempt ${attempt}/${maxRetries}: ${key}`)
      }

      const result = await new Promise<string>((resolve, reject) => {
        cos!.putObject(
          {
            Bucket: BUCKET,
            Region: REGION,
            Key: key,
            Body: buffer,
            // No ACL, keep private (default)
          },
          (err) => {
            if (err) {
              reject(err)
            } else {
              // Return COS Key (not full URL)
              resolve(key)
            }
          }
        )
      })

      if (attempt > 1) {
        _ulogInfo(`[COS Upload] Attempt ${attempt} succeeded: ${key}`)
      }
      return result

    } catch (error: unknown) {
      const errorInfo = extractErrorInfo(error)
      lastError = error

      // Log error details
      const errorDetails = {
        attempt,
        maxRetries,
        key,
        errorCode: errorInfo.code,
        errorMessage: errorInfo.message,
        isTimeoutError: errorInfo.code === 'ETIMEDOUT' || errorInfo.code === 'ESOCKETTIMEDOUT'
      }
      _ulogError(`[COS Upload] Attempt ${attempt}/${maxRetries} failed:`, JSON.stringify(errorDetails, null, 2))

      // If not last attempt, wait and retry
      if (attempt < maxRetries) {
        const delayMs = COS_RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1)  // Exponential backoff: 2s, 4s, 8s
        _ulogInfo(`[COS Upload] Waiting ${delayMs / 1000}s before retry...`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  // All retries failed
  _ulogError(`[COS Upload] All ${maxRetries} retries failed: ${key}`)
  throw lastError || new Error(`COS upload failed: ${key}`)
}

/**
 * Delete storage object (COS or local file)
 * @param key Storage key (e.g. images/xxx.png)
 */
export async function deleteCOSObject(key: string): Promise<void> {
  // ==================== Local storage mode ====================
  if (isLocalStorage) {
    try {
      const filePath = path.join(UPLOAD_DIR, key)
      await fs.unlink(filePath)
      _ulogInfo(`[Local Delete] Success: ${key}`)
    } catch (error: unknown) {
      const errorInfo = extractErrorInfo(error)
      // Ignore error when file does not exist
      if (errorInfo.code !== 'ENOENT') {
        _ulogError(`[Local Delete] Failed: ${key}`, errorInfo.message)
      }
    }
    return
  }

  // ==================== COS cloud storage mode ====================
  return new Promise((resolve, reject) => {
    cos!.deleteObject(
      {
        Bucket: BUCKET,
        Region: REGION,
        Key: key,
      },
      (err) => {
        if (err) {
          _ulogError('COS delete error:', err)
          reject(err)
        } else {
          resolve()
        }
      }
    )
  })
}

/**
 * Batch delete storage objects (COS or local file)
 * @param keys Storage key array
 * @returns Delete result stats
 */
export async function deleteCOSObjects(keys: string[]): Promise<{ success: number; failed: number }> {
  if (keys.length === 0) return { success: 0, failed: 0 }

  // Filter out empty and invalid keys
  const validKeys = keys.filter(key => key && typeof key === 'string' && key.trim().length > 0)
  if (validKeys.length === 0) return { success: 0, failed: 0 }

  // ==================== Local storage mode ====================
  if (isLocalStorage) {
    _ulogInfo(`[Local] Preparing to delete ${validKeys.length} files`)
    let success = 0
    let failed = 0

    for (const key of validKeys) {
      try {
        const filePath = path.join(UPLOAD_DIR, key)
        await fs.unlink(filePath)
        success++
      } catch (error: unknown) {
        const errorInfo = extractErrorInfo(error)
        if (errorInfo.code !== 'ENOENT') {
          failed++
        } else {
          success++ // File not found counts as success
        }
      }
    }

    _ulogInfo(`[Local] Delete complete: ${success} succeeded, ${failed} failed`)
    return { success, failed }
  }

  // ==================== COS cloud storage mode ====================
  _ulogInfo(`[COS] Preparing to delete ${validKeys.length} files`)

  // COS batch delete API max 1000 per call
  const batchSize = 1000
  let success = 0
  let failed = 0

  for (let i = 0; i < validKeys.length; i += batchSize) {
    const batch = validKeys.slice(i, i + batchSize)

    try {
      await new Promise<void>((resolve) => {
        cos!.deleteMultipleObject(
          {
            Bucket: BUCKET,
            Region: REGION,
            Objects: batch.map(key => ({ Key: key })),
          },
          (err, data) => {
            if (err) {
              _ulogError('[COS] Batch delete error:', err)
              failed += batch.length
              resolve() // Continue with other batches
            } else {
              // Count success and failure
              const deletedCount = data.Deleted?.length || 0
              const errorCount = data.Error?.length || 0
              success += deletedCount
              failed += errorCount

              if (errorCount > 0) {
                _ulogWarn('[COS] Some files failed to delete:', data.Error)
              }
              resolve()
            }
          }
        )
      })
    } catch (error) {
      _ulogError('[COS] Batch delete exception:', error)
      failed += batch.length
    }
  }

  _ulogInfo(`[COS] Delete complete: ${success} succeeded, ${failed} failed`)
  return { success, failed }
}

/**
 * Extract COS Key from URL or COS Key
 * Supports full URL and raw Key formats
 */
export function extractCOSKey(urlOrKey: string | null | undefined): string | null {
  if (!urlOrKey) return null

  // Local mode: handle /api/files/xxx local URL format
  if (urlOrKey.startsWith('/api/files/')) {
    return decodeURIComponent(urlOrKey.replace('/api/files/', ''))
  }

  // If already raw Key (no http and not relative path), return as-is
  if (!urlOrKey.startsWith('http') && !urlOrKey.startsWith('/')) {
    return urlOrKey
  }

  // Extract Key from full URL
  try {
    const url = new URL(urlOrKey)
    // Remove leading /
    return url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname
  } catch {
    return null
  }
}

/**
 * Download image from URL and upload to COS (with compression, timeout, retry)
 * @param imageUrl Source image URL
 * @param key File path
 * @param maxRetries Max retries, default 3
 * @returns COS Key
 */
export async function downloadAndUploadToCOS(imageUrl: string, key: string, maxRetries: number = COS_MAX_RETRIES): Promise<string> {
  let lastError: unknown = null
  const fetchUrl = toFetchableUrl(imageUrl)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        _ulogInfo(`[Image Download Upload] Attempt ${attempt}/${maxRetries}: ${imageUrl.substring(0, 80)}...`)
      }

      const sharp = (await import('sharp')).default

      // AbortController timeout (60 seconds)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), COS_TIMEOUT_MS)

      // Download image
      const response = await fetch(fetchUrl, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`Failed to download image: ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      // Compress image (keep resolution, max 10MB)
      let processedBuffer: Buffer
      let quality = 95 // Initial high quality
      const maxSizeMB = 10
      const maxSizeBytes = maxSizeMB * 1024 * 1024

      // Try high quality first
      processedBuffer = await sharp(buffer)
        .jpeg({ quality, mozjpeg: true })
        .toBuffer()

      // If over 10MB, reduce quality gradually
      while (processedBuffer.length > maxSizeBytes && quality > 60) {
        quality -= 5
        _ulogInfo(`Image size ${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB exceeds ${maxSizeMB}MB, reducing quality to ${quality}%`)
        processedBuffer = await sharp(buffer)
          .jpeg({ quality, mozjpeg: true })
          .toBuffer()
      }

      _ulogInfo(`Final image size: ${(processedBuffer.length / 1024 / 1024).toFixed(2)}MB, quality: ${quality}%`)

      // Change key extension to .jpg
      const jpgKey = key.replace(/\.(png|webp)$/i, '.jpg')

      // Upload to COS (uploadToCOS has retry)
      return await uploadToCOS(processedBuffer, jpgKey)

    } catch (error: unknown) {
      const errorInfo = extractErrorInfo(error)
      lastError = error

      // Log error details
      const errorDetails = {
        attempt,
        maxRetries,
        errorName: errorInfo.name,
        errorMessage: errorInfo.message,
        isAbortError: errorInfo.name === 'AbortError',
        isTimeoutError: errorInfo.name === 'AbortError' || errorInfo.code === 'ETIMEDOUT',
        imageUrl: imageUrl.substring(0, 80) + '...',
        fetchUrl: fetchUrl.substring(0, 80) + '...'
      }
      _ulogError(`[Image Download Upload] Attempt ${attempt}/${maxRetries} failed:`, JSON.stringify(errorDetails, null, 2))

      // If not last attempt, wait and retry
      if (attempt < maxRetries) {
        const delayMs = COS_RETRY_DELAY_BASE_MS * Math.pow(2, attempt - 1)
        _ulogInfo(`[Image Download Upload] Waiting ${delayMs / 1000}s before retry...`)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  // All retries failed
  _ulogError(`[Image download/upload] All ${maxRetries} retries failed`)
  throw lastError || new Error('Download and upload failed after all retries')
}

/**
 * Download video and upload to COS (no compression, with retries).
 * @param videoUrl Video URL
 * @param key File path/key
 * @param maxRetries Max retries (default 3)
 * @returns COS key
 */
export async function downloadAndUploadVideoToCOS(
  videoUrl: string,
  key: string,
  maxRetries: number = 3,
  requestHeaders?: Record<string, string>,
): Promise<string> {
  let lastError: unknown = null
  const fetchUrl = toFetchableUrl(videoUrl)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      _ulogInfo(`[Video download] Attempt ${attempt}/${maxRetries}: ${videoUrl.substring(0, 100)}...`)

      // AbortController timeout (5 min)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000)

      const response = await fetch(fetchUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VideoDownloader/1.0)',
          ...(requestHeaders || {}),
        },
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      // Content length for progress
      const contentLength = response.headers.get('content-length')
      _ulogInfo(`[Video download] Status: ${response.status}, size: ${contentLength ? (parseInt(contentLength) / 1024 / 1024).toFixed(2) + 'MB' : 'unknown'}`)

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      _ulogInfo(`[Video download] Done, size: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`)

      // Upload to COS (no compression for video)
      const cosKey = await uploadToCOS(buffer, key)
      _ulogInfo(`[Video upload] Uploaded to COS: ${cosKey}`)
      return cosKey

    } catch (error: unknown) {
      const errorInfo = extractErrorInfo(error)
      lastError = error

      // Log error details
      const errorDetails = {
        attempt,
        maxRetries,
        errorName: errorInfo.name,
        errorMessage: errorInfo.message,
        errorCause: errorInfo.cause ? String(errorInfo.cause) : undefined,
        errorCode: errorInfo.code,
        isAbortError: errorInfo.name === 'AbortError',
        isTimeoutError: errorInfo.name === 'AbortError' || errorInfo.message.includes('timeout'),
        isFetchError: errorInfo.message.includes('fetch failed') || errorInfo.name === 'TypeError',
        videoUrl: videoUrl.substring(0, 100) + '...',
        fetchUrl: fetchUrl.substring(0, 100) + '...'
      }

      _ulogError(`[Video download] Attempt ${attempt}/${maxRetries} failed:`, JSON.stringify(errorDetails, null, 2))

      if (attempt === maxRetries) {
        _ulogError(`[Video download] Max retries ${maxRetries} reached, giving up`)
        break
      }

      const delayMs = Math.pow(2, attempt) * 1000
      _ulogInfo(`[Video download] Retrying in ${delayMs / 1000}s...`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  const lastErrorInfo = lastError ? extractErrorInfo(lastError) : null
  const errorMessage = lastErrorInfo
    ? `Video download failed (after ${maxRetries} retries): ${lastErrorInfo.name || 'Error'} - ${lastErrorInfo.message}${lastErrorInfo.cause ? ` (cause: ${lastErrorInfo.cause})` : ''}`
    : `Video download failed (after ${maxRetries} retries): unknown error`

  throw new Error(errorMessage)
}

/**
 * Generate unique filename
 * @param prefix Prefix (e.g. character, location, shot)
 * @param ext Extension (e.g. png, jpg)
 * @returns Unique filename
 */
export function generateUniqueKey(prefix: string, ext: string = 'png'): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `images/${prefix}-${timestamp}-${random}.${ext}`
}

/**
 * Get file access URL (COS signed URL or local API path).
 * @param key File key (e.g. images/xxx.png)
 * @param _expires Kept for compatibility; expiry is fixed at 24h
 * @returns Accessible URL
 */
export function getSignedUrl(key: string, _expires: number = SIGNED_URL_EXPIRES_SECONDS): string {
  void _expires
  if (isLocalStorage) {
    return `/api/files/${encodeURIComponent(key)}`
  }

  // COS: fixed 24h expiry
  const url = cos!.getObjectUrl({
    Bucket: BUCKET,
    Region: REGION,
    Key: key,
    Sign: true,
    Expires: SIGNED_URL_EXPIRES_SECONDS,
  })
  return url
}

/**
 * Batch generate signed URLs.
 * @param keys COS file keys
 * @param _expires Expiry (seconds)
 * @returns Signed URL array
 */
export function getSignedUrls(keys: string[], _expires: number = SIGNED_URL_EXPIRES_SECONDS): string[] {
  return keys.map(key => getSignedUrl(key, _expires))
}

/**
 * Convert COS key to signed URL (handles null; full URLs returned as-is).
 * @param key COS key or null
 * @param _expires Expiry (seconds)
 * @returns Signed URL or null
 */
export function cosKeyToSignedUrl(key: string | null, _expires: number = SIGNED_URL_EXPIRES_SECONDS): string | null {
  if (!key) return null
  if (key.startsWith('http://') || key.startsWith('https://')) {
    return key
  }
  return getSignedUrl(key, _expires)
}

/**
 * Add signed URLs to Character object
 */
export function addSignedUrlsToCharacter(character: CharacterLike) {
  // Process appearances array (object array, not JSON string)
  const appearances = character.appearances?.map((app) => {
    const imageUrls = decodeImageUrlsFromDb(app.imageUrls, 'appearance.imageUrls')
      .map((key) => cosKeyToSignedUrl(key))
      .filter((url): url is string => !!url)

    let descriptions: string[] | null = null
    if (app.descriptions) {
      try {
        descriptions = typeof app.descriptions === 'string' ? JSON.parse(app.descriptions) : app.descriptions
      } catch (error: unknown) {
        _ulogError(`[Signed URL] Failed to parse descriptions:`, app.descriptions, error)
      }
    }

    const signedImageUrl = cosKeyToSignedUrl(app.imageUrl)

    return {
      ...app,
      imageUrl: signedImageUrl,
      imageUrls,
      descriptions
    }
  }) || []

  return {
    ...character,
    appearances,
    // Process custom voice audio URL
    customVoiceUrl: character.customVoiceUrl ? cosKeyToSignedUrl(character.customVoiceUrl) : null
  }
}

/**
 * Add signed URL to Location object
 */
export function addSignedUrlToLocation(location: LocationLike) {
  // Process images array (object array, not JSON string)
  const images = location.images?.map((img) => ({
    ...img,
    imageUrl: cosKeyToSignedUrl(img.imageUrl)
  })) || []

  return {
    ...location,
    images
  }
}

/**
 * Add signed URLs to Shot object
 */
export function addSignedUrlsToShot(shot: ShotLike) {
  return {
    ...shot,
    imageUrl: cosKeyToSignedUrl(shot.imageUrl),
    videoUrl: cosKeyToSignedUrl(shot.videoUrl),
  }
}

/**
 * Add signed URL to AssetLibraryCharacter object
 */
export function addSignedUrlToAssetCharacter(character: { imageUrl: string | null } & UnknownRecord) {
  return {
    ...character,
    imageUrl: cosKeyToSignedUrl(character.imageUrl),
  }
}

/**
 * Add signed URL to AssetLibraryLocation object
 */
export function addSignedUrlToAssetLocation(location: { imageUrl: string | null } & UnknownRecord) {
  return {
    ...location,
    imageUrl: cosKeyToSignedUrl(location.imageUrl),
  }
}

/**
 * Add signed URLs to Storyboard object
 * Uses panel.imageUrl as sole image source
 */
export function addSignedUrlsToStoryboard(storyboard: StoryboardLike) {
  // Process Panel records (Panel table is sole data source)
  let panels: PanelLike[] = []
  if (storyboard.panels && Array.isArray(storyboard.panels)) {
    panels = storyboard.panels.map((dbPanel) => {
      let panelHistoryCount = 0
      const historyField = dbPanel.panelImageHistory || dbPanel.imageHistory
      if (historyField) {
        try {
          const history = JSON.parse(historyField)
          panelHistoryCount = Array.isArray(history) ? history.length : 0
        } catch { }
      }

      // panel.imageUrl is sole data source
      const imageKey = dbPanel.imageUrl
      let finalImageUrl: string | null = null
      if (imageKey) {
        finalImageUrl = cosKeyToSignedUrl(imageKey)
      }

      // Process candidateImages: convert COS key to signed URL, keep PENDING items unchanged
      let signedCandidateImages = dbPanel.candidateImages
      if (signedCandidateImages) {
        try {
          const candidates = JSON.parse(signedCandidateImages)
          if (Array.isArray(candidates)) {
            const signedCandidates = candidates.map((candidate) => {
              if (typeof candidate !== 'string') return candidate
              // PENDING prefix stays unchanged (still generating)
              if (candidate.startsWith('PENDING:')) return candidate
              // Completed ones convert to signed URL
              return cosKeyToSignedUrl(candidate) || candidate
            })
            signedCandidateImages = JSON.stringify(signedCandidates)
          }
        } catch { }
      }

      return {
        ...dbPanel,
        imageUrl: finalImageUrl,
        // Two-step storyboard: sketch image URL
        sketchImageUrl: cosKeyToSignedUrl(dbPanel.sketchImageUrl),
        videoUrl: dbPanel.videoUrl && !dbPanel.videoUrl.startsWith('http')
          ? getSignedUrl(dbPanel.videoUrl, 7200)
          : dbPanel.videoUrl,
        // Lip sync video URL
        lipSyncVideoUrl: dbPanel.lipSyncVideoUrl && !dbPanel.lipSyncVideoUrl.startsWith('http')
          ? getSignedUrl(dbPanel.lipSyncVideoUrl, 7200)
          : dbPanel.lipSyncVideoUrl,
        // Candidate image signed URLs
        candidateImages: signedCandidateImages,
        historyCount: panelHistoryCount
      }
    })
  }

  // Count storyboard history versions
  let historyCount = 0
  if (storyboard.imageHistory) {
    try {
      const history = JSON.parse(storyboard.imageHistory)
      historyCount = Array.isArray(history) ? history.length : 0
    } catch { }
  }

  return {
    ...storyboard,
    storyboardImageUrl: cosKeyToSignedUrl(storyboard.storyboardImageUrl),
    panels,
    historyCount
  }
}

/**
 * Add signed URLs to all Project resources
 */
export function addSignedUrlsToProject(project: ProjectLike) {
  return {
    ...project,
    // Process audioUrl (for novel-promotion TTS)
    audioUrl: project.audioUrl ? getSignedUrl(project.audioUrl) : project.audioUrl,
    characters: project.characters?.map(addSignedUrlsToCharacter) || [],
    locations: project.locations?.map(addSignedUrlToLocation) || [],
    shots: project.shots?.map(addSignedUrlsToShot) || [],
    storyboards: project.storyboards?.map(addSignedUrlsToStoryboard) || [],
  }
}

/**
 * Convert COS Key or URL to Base64
 * @param keyOrUrl COS Key (e.g. images/xxx.png) or full URL
 * @returns Base64 string (data:image/png;base64,...)
 */
export async function imageUrlToBase64(keyOrUrl: string): Promise<string> {
  try {
    return await normalizeToBase64ForGeneration(keyOrUrl)
  } catch (error) {
    _ulogError(`Failed to convert to Base64: ${keyOrUrl}`, error)
    throw error
  }
}
