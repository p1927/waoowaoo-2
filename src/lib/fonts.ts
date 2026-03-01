import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import fs from 'fs'
import path from 'path'
import { ImageResponse } from '@vercel/og'
import type { ReactElement } from 'react'

// Possible font file paths (try in order of priority)
const POSSIBLE_FONT_PATHS = [
    path.join(process.cwd(), 'src/assets/fonts/NotoSansSC-Regular.ttf'),
    path.join(process.cwd(), '.next/server/src/assets/fonts/NotoSansSC-Regular.ttf'),
]

// Cache font data (load once)
let fontDataCache: Buffer | null = null
let fontInitialized = false

/**
 * Load font file
 */
function loadFontData(): Buffer | null {
    if (fontDataCache) {
        return fontDataCache
    }

    _ulogInfo('[Fonts] Searching for font file...')

    for (const fontPath of POSSIBLE_FONT_PATHS) {
        _ulogInfo('[Fonts] Trying:', fontPath)
        if (fs.existsSync(fontPath)) {
            fontDataCache = fs.readFileSync(fontPath)
            _ulogInfo('[Fonts] ✅ Font loaded:', fontPath, `(${(fontDataCache.length / 1024 / 1024).toFixed(2)} MB)`)
            return fontDataCache
        }
    }

    _ulogError('[Fonts] ❌ Font file not found')
    return null
}

/**
 * Initialize font config (preload font into memory)
 */
export async function initializeFonts(): Promise<void> {
    if (fontInitialized) {
        return
    }

    loadFontData()
    fontInitialized = true
}

/**
 * Get font family name
 */
export function getFontFamily(): string {
    return 'NotoSansSC'
}

/**
 * Generate label image (PNG Buffer) using @vercel/og
 * Uses pure WebAssembly, no native modules or system libs
 * Works in both local and Vercel environments
 */
export async function createLabelSVG(
    width: number,
    barHeight: number,
    fontSize: number,
    padding: number,
    labelText: string
): Promise<Buffer> {
    const fontData = loadFontData()

    if (!fontData) {
        _ulogError('[Fonts] Cannot create label image without font')
        // Return empty black image
        return createFallbackImage(width, barHeight)
    }

    try {
        // Use @vercel/og ImageResponse to generate image
        const response = new ImageResponse(
            {
                type: 'div',
                props: {
                    style: {
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        backgroundColor: 'black',
                        paddingLeft: padding,
                        paddingRight: padding,
                    },
                    children: {
                        type: 'span',
                        props: {
                            style: {
                                color: 'white',
                                fontSize: fontSize,
                                fontWeight: 'bold',
                                fontFamily: 'NotoSansSC',
                            },
                            children: labelText,
                        },
                    },
                },
            } as unknown as ReactElement,
            {
                width: width,
                height: barHeight,
                fonts: [
                    {
                        name: 'NotoSansSC',
                        data: fontData,
                        weight: 400,
                        style: 'normal',
                    },
                ],
            }
        )

        // Get Buffer from Response
        const arrayBuffer = await response.arrayBuffer()
        return Buffer.from(arrayBuffer)
    } catch (error) {
        _ulogError('[Fonts] Error creating label image:', error)
        return createFallbackImage(width, barHeight)
    }
}

/**
 * Create fallback black image (when font load fails)
 */
async function createFallbackImage(width: number, height: number): Promise<Buffer> {
    // Use sharp to create a black rectangle
    const sharp = (await import('sharp')).default
    return sharp({
        create: {
            width: width,
            height: height,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 },
        },
    })
        .png()
        .toBuffer()
}
