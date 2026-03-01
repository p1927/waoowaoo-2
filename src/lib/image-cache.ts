import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { toFetchableUrl } from '@/lib/cos'
import LRUCache from 'lru-cache'
/**
 * Image download cache system
 *
 * Solves: When batch-generating storyboards, each request repeatedly downloads the same reference images.
 *
 * Implementation:
 * - Uses LRU cache for in-flight download Promises
 * - Concurrent requests for the same URL share the same Promise
 * - Cache has TTL to avoid memory leaks
 */

// Cache entry type
interface CacheEntry {
    promise: Promise<string>  // Promise of Base64 result
    expiresAt: number         // Expiration timestamp
    size?: number             // Image size (bytes)
}

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000  // 5 minute TTL
const MAX_CACHE_SIZE = 100          // Max 100 cached images
const CLEANUP_INTERVAL_MS = 60 * 1000  // Cleanup every minute

// Global cache
const imageCache = new LRUCache<string, CacheEntry>({
    max: MAX_CACHE_SIZE,
    ttl: CACHE_TTL_MS,
    ttlAutopurge: true,
})

// Statistics
let cacheHits = 0
let cacheMisses = 0
let totalDownloadTime = 0

/**
 * Get image Base64 (with cache)
 *
 * @param imageUrl Image URL (http/https) or already base64
 * @param options Options
 * @returns Base64 image data (data:image/...;base64,...)
 */
export async function getImageBase64Cached(
    imageUrl: string,
    options: {
        logPrefix?: string
        forceRefresh?: boolean
    } = {}
): Promise<string> {
    const { logPrefix = '[Image Cache]', forceRefresh = false } = options

    // If already base64, return directly
    if (imageUrl.startsWith('data:')) {
        return imageUrl
    }

    let fullUrl = imageUrl
    if (!imageUrl.startsWith('http') && !imageUrl.startsWith('/')) {
        throw new Error(`Invalid image URL: ${imageUrl.substring(0, 50)}...`)
    }
    fullUrl = toFetchableUrl(fullUrl)

    const cacheKey = imageUrl

    // Check cache
    if (!forceRefresh) {
        const cached = imageCache.get(cacheKey)
        if (cached && cached.expiresAt > Date.now()) {
            cacheHits++
            _ulogInfo(`${logPrefix} ✅ Cache hit (${cacheHits}/${cacheHits + cacheMisses})`)
            return cached.promise
        }
    }

    cacheMisses++

    // Create download Promise (shared by all concurrent requests)
    const downloadPromise = downloadImageAsBase64(fullUrl, logPrefix)

    // Store in cache
    imageCache.set(cacheKey, {
        promise: downloadPromise,
        expiresAt: Date.now() + CACHE_TTL_MS
    })

    // Update size after download completes
    downloadPromise.then(base64 => {
        const entry = imageCache.get(cacheKey)
        if (entry) {
            entry.size = base64.length
        }
    }).catch(() => {
        // Download failed, remove from cache
        imageCache.delete(cacheKey)
    })

    return downloadPromise
}

/**
 * Download image and convert to Base64
 */
async function downloadImageAsBase64(imageUrl: string, logPrefix: string): Promise<string> {
    const startTime = Date.now()
    _ulogInfo(`${logPrefix} Starting download: ${imageUrl.substring(0, 80)}...`)

    try {
        const response = await fetch(toFetchableUrl(imageUrl), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; ImageDownloader/1.0)'
            }
        })

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        const buffer = await response.arrayBuffer()
        const base64 = Buffer.from(buffer).toString('base64')
        const contentType = response.headers.get('content-type') || 'image/png'

        const duration = Date.now() - startTime
        totalDownloadTime += duration
        const sizeKB = Math.round(buffer.byteLength / 1024)

        _ulogInfo(`${logPrefix} ✅ Download complete: ${sizeKB}KB, ${duration}ms`)

        return `data:${contentType};base64,${base64}`
    } catch (error: unknown) {
        const duration = Date.now() - startTime
        const message =
            error instanceof Error
                ? error.message
                : (typeof error === 'object' && error !== null && typeof (error as { message?: unknown }).message === 'string')
                    ? (error as { message: string }).message
                    : 'Unknown error'
        _ulogError(`${logPrefix} ❌ Download failed (${duration}ms): ${message}`)
        throw error
    }
}

/**
 * Batch preload images (parallel download, shared cache)
 *
 * @param imageUrls Image URL list
 * @param options Options
 * @returns Base64 image array (in original order)
 */
export async function preloadImagesParallel(
    imageUrls: string[],
    options: {
        logPrefix?: string
        maxConcurrency?: number
    } = {}
): Promise<string[]> {
    const { logPrefix = '[Batch Preload]' } = options

    // Deduplicate (supports http URL and local relative path /api/files/...)
    const uniqueUrls = [...new Set(imageUrls.filter(url => url && (url.startsWith('http') || url.startsWith('/'))))]

    if (uniqueUrls.length === 0) {
        return imageUrls.map(url => url?.startsWith('data:') ? url : '')
    }

    _ulogInfo(`${logPrefix} Starting preload of ${uniqueUrls.length} unique images (original: ${imageUrls.length})`)

    const startTime = Date.now()

    // Download all unique images in parallel
    const downloadPromises = uniqueUrls.map(url =>
        getImageBase64Cached(url, { logPrefix })
    )

    // Wait for all downloads to complete
    const results = await Promise.allSettled(downloadPromises)

    // Build URL -> Base64 map
    const urlToBase64 = new Map<string, string>()
    results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
            urlToBase64.set(uniqueUrls[index], result.value)
        }
    })

    const duration = Date.now() - startTime
    const successCount = results.filter(r => r.status === 'fulfilled').length
    _ulogInfo(`${logPrefix} Preload complete: ${successCount}/${uniqueUrls.length} succeeded, ${duration}ms`)

    // Return in original order
    return imageUrls.map(url => {
        if (!url) return ''
        if (url.startsWith('data:')) return url
        return urlToBase64.get(url) || ''
    })
}

/**
 * Clean up expired cache entries
 */
function cleanupExpiredCache() {
    const before = imageCache.size
    imageCache.purgeStale()
    const cleaned = before - imageCache.size

    if (cleaned > 0) {
        _ulogInfo(`[Image Cache] Cleaned ${cleaned} expired entries, ${imageCache.size} remaining`)
    }
}

/**
 * Get cache statistics
 */
export function getImageCacheStats() {
    const now = Date.now()
    let validCount = 0
    let totalSize = 0

    for (const entry of imageCache.values()) {
        if (entry.expiresAt > now) {
            validCount++
            totalSize += entry.size || 0
        }
    }

    return {
        cacheSize: imageCache.size,
        validEntries: validCount,
        totalSizeKB: Math.round(totalSize / 1024),
        cacheHits,
        cacheMisses,
        hitRate: cacheHits + cacheMisses > 0
            ? Math.round(cacheHits / (cacheHits + cacheMisses) * 100)
            : 0,
        totalDownloadTimeMs: totalDownloadTime
    }
}

/**
 * Clear cache
 */
export function clearImageCache() {
    imageCache.clear()
    cacheHits = 0
    cacheMisses = 0
    totalDownloadTime = 0
    _ulogInfo('[Image Cache] Cleared')
}

// Periodic cleanup
setInterval(cleanupExpiredCache, CLEANUP_INTERVAL_MS)
