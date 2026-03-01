import { VideoClip, ComputedClip, VideoEditorProject } from '../types/editor.types'

/**
 * Compute total timeline duration in frames (account for transition overlap)
 */
export function calculateTimelineDuration(clips: VideoClip[]): number {
    if (clips.length === 0) return 0

    return clips.reduce((total, clip, index) => {
        let duration = clip.durationInFrames

        // Last clip: do not subtract transition
        if (index < clips.length - 1 && clip.transition) {
            // Transition overlap shortens total
            duration -= Math.floor(clip.transition.durationInFrames / 2)
        }

        return total + duration
    }, 0)
}

/**
 * Compute start frame for each clip (for render and UI)
 */
export function computeClipPositions(clips: VideoClip[]): ComputedClip[] {
    let currentFrame = 0

    return clips.map((clip, index) => {
        const startFrame = currentFrame
        const endFrame = startFrame + clip.durationInFrames

        // Next clip start (transition overlap)
        if (clip.transition && index < clips.length - 1) {
            currentFrame = endFrame - Math.floor(clip.transition.durationInFrames / 2)
        } else {
            currentFrame = endFrame
        }

        return {
            ...clip,
            startFrame,
            endFrame
        }
    })
}

/**
 * Frames to time string
 */
export function framesToTime(frames: number, fps: number): string {
    const totalSeconds = frames / fps
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = Math.floor(totalSeconds % 60)
    const milliseconds = Math.floor((totalSeconds % 1) * 100)

    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${milliseconds.toString().padStart(2, '0')}`
}

/**
 * Time string to frames
 */
export function timeToFrames(time: string, fps: number): number {
    const [minSec, ms] = time.split('.')
    const [minutes, seconds] = minSec.split(':').map(Number)
    const totalSeconds = minutes * 60 + seconds + (parseInt(ms || '0') / 100)
    return Math.round(totalSeconds * fps)
}

/**
 * Generate unique clip ID
 */
export function generateClipId(): string {
    return `clip_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Create default editor project
 */
export function createDefaultProject(episodeId: string): VideoEditorProject {
    return {
        id: `editor_${Date.now()}`,
        episodeId,
        schemaVersion: '1.0',
        config: {
            fps: 30,
            width: 1920,
            height: 1080
        },
        timeline: [],
        bgmTrack: []
    }
}
