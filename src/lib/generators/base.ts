import { logWarn as _ulogWarn } from '@/lib/logging/core'
/**
 * Generator base interfaces and type definitions
 *
 * Strategy pattern: all generators implement a unified interface
 */

// ============================================================
// Common types
// ============================================================

export interface GenerateOptions {
    aspectRatio?: string      // Aspect ratio, e.g. '16:9', '3:4'
    resolution?: string        // Resolution, e.g. '2K', '4K'
    outputFormat?: string      // Output format, e.g. 'png', 'jpg'
    duration?: number          // Video duration (seconds)
    fps?: number              // Frame rate
    [key: string]: unknown        // Other provider-specific params
}

export interface GenerateResult {
    success: boolean
    imageUrl?: string         // Image URL
    imageBase64?: string      // Image base64
    videoUrl?: string         // Video URL
    audioUrl?: string         // Audio URL
    error?: string           // Error message
    requestId?: string       // Async task ID (legacy format)
    async?: boolean          // Whether async task
    endpoint?: string        // Async task endpoint (legacy)
    externalId?: string      // Standard async task ID format (e.g. FAL:IMAGE:fal-ai/nano-banana-pro:requestId)
}

// ============================================================
// Image generator interface
// ============================================================

export interface ImageGenerateParams {
    userId: string
    prompt: string
    referenceImages?: string[]  // Reference image URLs or base64
    options?: GenerateOptions
}

export interface ImageGenerator {
    /**
     * Generate image
     */
    generate(params: ImageGenerateParams): Promise<GenerateResult>
}

// ============================================================
// Video generator interface
// ============================================================

export interface VideoGenerateParams {
    userId: string
    imageUrl: string           // Starting image
    prompt?: string            // Prompt (optional)
    options?: GenerateOptions
}

export interface VideoGenerator {
    /**
     * Generate video
     */
    generate(params: VideoGenerateParams): Promise<GenerateResult>
}

// ============================================================
// Audio generator interface
// ============================================================

export interface AudioGenerateParams {
    userId: string
    text: string              // Text content
    voice?: string            // Voice
    rate?: number             // Speech rate
    options?: GenerateOptions
}

export interface AudioGenerator {
    /**
     * Generate speech
     */
    generate(params: AudioGenerateParams): Promise<GenerateResult>
}

// ============================================================
// Base classes (provide common functionality)
// ============================================================

export abstract class BaseImageGenerator implements ImageGenerator {
    /**
     * Generate image (with retry)
     */
    async generate(params: ImageGenerateParams): Promise<GenerateResult> {
        const maxRetries = 2
        let lastError: unknown = null

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.doGenerate(params)
            } catch (error: unknown) {
                lastError = error
                const message = error instanceof Error ? error.message : String(error)
                _ulogWarn(`[Generator] Attempt ${attempt}/${maxRetries} failed: ${message}`)

                // Last attempt, throw directly
                if (attempt === maxRetries) {
                    break
                }

                // Wait before retry
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
            }
        }

        return {
            success: false,
            error: lastError instanceof Error ? lastError.message : 'Generation failed'
        }
    }

    /**
     * Subclasses implement concrete generation logic
     */
    protected abstract doGenerate(params: ImageGenerateParams): Promise<GenerateResult>
}

export abstract class BaseVideoGenerator implements VideoGenerator {
    async generate(params: VideoGenerateParams): Promise<GenerateResult> {
        const maxRetries = 2
        let lastError: unknown = null

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.doGenerate(params)
            } catch (error: unknown) {
                lastError = error
                const message = error instanceof Error ? error.message : String(error)
                _ulogWarn(`[Video Generator] Attempt ${attempt}/${maxRetries} failed: ${message}`)
                if (attempt === maxRetries) break
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
            }
        }

        return {
            success: false,
            error: lastError instanceof Error ? lastError.message : 'Video generation failed'
        }
    }

    protected abstract doGenerate(params: VideoGenerateParams): Promise<GenerateResult>
}

export abstract class BaseAudioGenerator implements AudioGenerator {
    async generate(params: AudioGenerateParams): Promise<GenerateResult> {
        const maxRetries = 2
        let lastError: unknown = null

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                return await this.doGenerate(params)
            } catch (error: unknown) {
                lastError = error
                const message = error instanceof Error ? error.message : String(error)
                _ulogWarn(`[Audio Generator] Attempt ${attempt}/${maxRetries} failed: ${message}`)
                if (attempt === maxRetries) break
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt))
            }
        }

        return {
            success: false,
            error: lastError instanceof Error ? lastError.message : 'Speech generation failed'
        }
    }

    protected abstract doGenerate(params: AudioGenerateParams): Promise<GenerateResult>
}
