import { logError as _ulogError } from '@/lib/logging/core'
/**
 * Image black-bar label utilities
 * Add or update top black-bar text labels on images
 */

import sharp from 'sharp'
import { uploadToCOS, getSignedUrl, generateUniqueKey, toFetchableUrl } from '@/lib/cos'
import { decodeImageUrlsFromDb, encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { initializeFonts, createLabelSVG } from '@/lib/fonts'

/**
 * Update image black-bar label (crop old label + add new label)
 *
 * @param imageUrl - Original image URL or COS key
 * @param newLabelText - New label text
 * @param options - Optional config
 * @returns Updated COS key
 */
export async function updateImageLabel(
    imageUrl: string,
    newLabelText: string,
    options?: {
        /** Whether to generate new key (default: overwrite original) */
        generateNewKey?: boolean
        /** New key prefix (only when generateNewKey=true) */
        keyPrefix?: string
    }
): Promise<string> {
    await initializeFonts()

    const originalKey = await resolveStorageKeyFromMediaValue(imageUrl)
    if (!originalKey) {
        throw new Error(`Cannot normalize media key: ${imageUrl}`)
    }
    const signedUrl = getSignedUrl(originalKey, 3600)

    // Download image
    const response = await fetch(toFetchableUrl(signedUrl))
    if (!response.ok) {
        throw new Error(`Failed to download image: ${response.status}`)
    }
    const buffer = Buffer.from(await response.arrayBuffer())

    // Get image metadata
    const meta = await sharp(buffer).metadata()
    const w = meta.width || 2160
    const h = meta.height || 2160

    // Compute label bar height (same as generation: 4% of height)
    const fontSize = Math.floor(h * 0.04)
    const pad = Math.floor(fontSize * 0.5)
    const barH = fontSize + pad * 2

    // Crop out top old label bar
    const croppedBuffer = await sharp(buffer)
        .extract({ left: 0, top: barH, width: w, height: h - barH })
        .toBuffer()

    // Create new SVG label bar
    const svg = await createLabelSVG(w, barH, fontSize, pad, newLabelText)

    // Add new label bar to top of image
    const processed = await sharp(croppedBuffer)
        .extend({ top: barH, bottom: 0, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 1 } })
        .composite([{ input: svg, top: 0, left: 0 }])
        .jpeg({ quality: 90, mozjpeg: true })
        .toBuffer()

    // Decide whether to use original key or generate new key
    const finalKey = options?.generateNewKey
        ? generateUniqueKey(options.keyPrefix || 'labeled-image', 'jpg')
        : originalKey

    await uploadToCOS(processed, finalKey)
    return finalKey
}

/**
 * Batch update character appearance labels
 * Used when copying character from Asset Hub to project
 */
export async function updateCharacterAppearanceLabels(
    appearances: Array<{
        imageUrl: string | null
        imageUrls: string
        changeReason: string
    }>,
    characterName: string
): Promise<Array<{ imageUrl: string | null; imageUrls: string }>> {
    const results: Array<{ imageUrl: string | null; imageUrls: string }> = []

    for (const appearance of appearances) {
        try {
            // Get image URLs
            let imageUrls = decodeImageUrlsFromDb(appearance.imageUrls, 'appearance.imageUrls')
            if (imageUrls.length === 0 && appearance.imageUrl) {
                imageUrls = [appearance.imageUrl]
            }

            if (imageUrls.length === 0) {
                results.push({ imageUrl: null, imageUrls: encodeImageUrls([]) })
                continue
            }

            // Update label for each image
            const newLabelText = `${characterName} - ${appearance.changeReason}`
            const newImageUrls: string[] = await Promise.all(
                imageUrls.map(async (url) => {
                    if (!url) return ''
                    try {
                        // Generate new key to avoid overwriting Asset Hub original
                        return await updateImageLabel(url, newLabelText, {
                            generateNewKey: true,
                            keyPrefix: `project-char-copy`
                        })
                    } catch (e) {
                        _ulogError(`Failed to update label for image:`, e)
                        return url // Keep original URL on failure
                    }
                })
            )

            const firstUrl = newImageUrls.find((u) => !!u) || null
            results.push({
                imageUrl: firstUrl,
                imageUrls: encodeImageUrls(newImageUrls)
            })
        } catch (e) {
            _ulogError('Failed to update appearance labels:', e)
            results.push({ imageUrl: appearance.imageUrl, imageUrls: appearance.imageUrls })
        }
    }

    return results
}

/**
 * Batch update location image labels
 * Used when copying location from Asset Hub to project
 */
export async function updateLocationImageLabels(
    images: Array<{
        imageUrl: string | null
    }>,
    locationName: string
): Promise<Array<{ imageUrl: string | null }>> {
    const results: Array<{ imageUrl: string | null }> = []

    for (const image of images) {
        if (!image.imageUrl) {
            results.push({ imageUrl: null })
            continue
        }

        try {
            // Generate new key to avoid overwriting Asset Hub original
            const newImageUrl = await updateImageLabel(image.imageUrl, locationName, {
                generateNewKey: true,
                keyPrefix: `project-loc-copy`
            })
            results.push({ imageUrl: newImageUrl })
        } catch (e) {
            _ulogError('Failed to update location image label:', e)
            results.push({ imageUrl: image.imageUrl })
        }
    }

    return results
}
