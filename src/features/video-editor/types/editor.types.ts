// ========================================
// Video Editor Core Types
// Schema Version: 1.0
// ========================================

/**
 * Editor project - top-level structure
 */
export interface VideoEditorProject {
    id: string
    episodeId: string
    schemaVersion: '1.0'

    config: EditorConfig

    // Main timeline (order = time)
    timeline: VideoClip[]

    // BGM track (absolute positioning)
    bgmTrack: BgmClip[]
}

/**
 * Editor config
 */
export interface EditorConfig {
    fps: number
    width: number
    height: number
}

/**
 * Video clip - timeline unit
 */
export interface VideoClip {
    id: string
    src: string                    // COS URL
    durationInFrames: number       // Play duration

    // In-clip trim (optional)
    trim?: {
        from: number               // Source start frame
        to: number                 // Source end frame
    }

    // Attachment (moves with clip)
    attachment?: ClipAttachment

    // Transition to next clip
    transition?: ClipTransition

    // AI metadata (traceability)
    metadata: ClipMetadata
}

/**
 * Clip attachment (dub + subtitle)
 */
export interface ClipAttachment {
    audio?: {
        src: string
        volume: number
        voiceLineId?: string
    }
    subtitle?: {
        text: string
        style: 'default' | 'cinematic'
    }
}

/**
 * Transition effect
 */
export interface ClipTransition {
    type: 'none' | 'dissolve' | 'fade' | 'slide'
    durationInFrames: number
}

/**
 * Clip metadata
 */
export interface ClipMetadata {
    panelId: string
    storyboardId: string
    description?: string
}

/**
 * BGM clip - separate track
 */
export interface BgmClip {
    id: string
    src: string
    startFrame: number             // Absolute position
    durationInFrames: number
    volume: number
    fadeIn?: number
    fadeOut?: number
}

// ========================================
// Timeline UI state
// ========================================

export interface TimelineState {
    currentFrame: number
    playing: boolean
    selectedClipId: string | null
    zoom: number                   // Zoom (1 = 100%)
}

// ========================================
// Computed types
// ========================================

export interface ComputedClip extends VideoClip {
    startFrame: number             // Computed start frame
    endFrame: number               // Computed end frame
}

// ========================================
// API types
// ========================================

export interface SaveEditorProjectRequest {
    projectData: VideoEditorProject
}

export interface RenderRequest {
    editorProjectId: string
    format: 'mp4' | 'webm'
    quality: 'draft' | 'high'
}

export interface RenderStatus {
    status: 'pending' | 'rendering' | 'completed' | 'failed'
    progress?: number
    outputUrl?: string
    error?: string
}
