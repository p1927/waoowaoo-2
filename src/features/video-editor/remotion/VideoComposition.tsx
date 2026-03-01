import React from 'react'
import { AbsoluteFill, Sequence, Video, Audio, useCurrentFrame, interpolate } from 'remotion'
import { VideoClip, BgmClip, EditorConfig } from '../types/editor.types'
import { computeClipPositions } from '../utils/time-utils'

interface VideoCompositionProps {
    clips: VideoClip[]
    bgmTrack: BgmClip[]
    config: EditorConfig
}

/**
 * Remotion main composition - Sequence-based timeline with transitions
 */
export const VideoComposition: React.FC<VideoCompositionProps> = ({
    clips,
    bgmTrack,
    config
}) => {
    const computedClips = computeClipPositions(clips)

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            {/* Video track with transitions */}
            {computedClips.map((clip, index) => {
                const transitionDuration = clip.transition?.durationInFrames || 0

                return (
                    <Sequence
                        key={clip.id}
                        from={clip.startFrame}
                        durationInFrames={clip.durationInFrames}
                        name={`Clip ${index + 1}`}
                    >
                        <ClipRenderer
                            clip={clip}
                            config={config}
                            transitionType={clip.transition?.type}
                            transitionDuration={transitionDuration}
                            isLastClip={index === computedClips.length - 1}
                        />
                    </Sequence>
                )
            })}

            {/* BGM track */}
            {bgmTrack.map((bgm) => (
                <Sequence
                    key={bgm.id}
                    from={bgm.startFrame}
                    durationInFrames={bgm.durationInFrames}
                    name={`BGM: ${bgm.id}`}
                >
                    <BgmRenderer bgm={bgm} />
                </Sequence>
            ))}
        </AbsoluteFill>
    )
}

/**
 * BGM renderer with fade in/out
 */
interface BgmRendererProps {
    bgm: BgmClip
}

const BgmRenderer: React.FC<BgmRendererProps> = ({ bgm }) => {
    const frame = useCurrentFrame()
    const fadeIn = bgm.fadeIn || 0
    const fadeOut = bgm.fadeOut || 0

    let volume = bgm.volume

    // Fade in
    if (fadeIn > 0 && frame < fadeIn) {
        volume *= interpolate(frame, [0, fadeIn], [0, 1], { extrapolateRight: 'clamp' })
    }

    // Fade out
    if (fadeOut > 0 && frame > bgm.durationInFrames - fadeOut) {
        volume *= interpolate(
            frame,
            [bgm.durationInFrames - fadeOut, bgm.durationInFrames],
            [1, 0],
            { extrapolateLeft: 'clamp' }
        )
    }

    return <Audio src={bgm.src} volume={volume} />
}

/**
 * Single clip renderer with transition
 */
interface ClipRendererProps {
    clip: VideoClip & { startFrame: number; endFrame: number }
    config: EditorConfig
    transitionType?: 'none' | 'dissolve' | 'fade' | 'slide'
    transitionDuration: number
    isLastClip: boolean
}

const ClipRenderer: React.FC<ClipRendererProps> = ({
    clip,
    config,
    transitionType = 'none',
    transitionDuration,
    isLastClip
}) => {
    void config
    const frame = useCurrentFrame()
    const clipDuration = clip.durationInFrames

    // Compute transition
    let opacity = 1
    let transform = 'none'

    if (transitionType !== 'none' && transitionDuration > 0) {
        // Exit transition (end of clip)
        if (!isLastClip && frame > clipDuration - transitionDuration) {
            const exitProgress = interpolate(
                frame,
                [clipDuration - transitionDuration, clipDuration],
                [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
            )

            switch (transitionType) {
                case 'dissolve':
                case 'fade':
                    opacity = 1 - exitProgress
                    break
                case 'slide':
                    transform = `translateX(${-exitProgress * 100}%)`
                    break
            }
        }

        // Enter transition (start of clip)
        if (frame < transitionDuration) {
            const enterProgress = interpolate(
                frame,
                [0, transitionDuration],
                [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
            )

            switch (transitionType) {
                case 'dissolve':
                case 'fade':
                    opacity = enterProgress
                    break
                case 'slide':
                    transform = `translateX(${(1 - enterProgress) * 100}%)`
                    break
            }
        }
    }

    return (
        <AbsoluteFill style={{ opacity, transform }}>
            {/* Video */}
            <Video
                src={clip.src}
                startFrom={clip.trim?.from || 0}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                }}
            />

            {/* Attached audio */}
            {clip.attachment?.audio && (
                <Audio
                    src={clip.attachment.audio.src}
                    volume={clip.attachment.audio.volume}
                />
            )}

            {/* Attached subtitle */}
            {clip.attachment?.subtitle && (
                <SubtitleOverlay
                    text={clip.attachment.subtitle.text}
                    style={clip.attachment.subtitle.style}
                />
            )}
        </AbsoluteFill>
    )
}

/**
 * Subtitle overlay
 */
interface SubtitleOverlayProps {
    text: string
    style: 'default' | 'cinematic'
}

const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({ text, style }) => {
    const styles = {
        default: {
            background: 'rgba(0, 0, 0, 0.7)',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '24px',
            color: 'white'
        },
        cinematic: {
            background: 'transparent',
            padding: '12px 24px',
            fontSize: '28px',
            color: 'white',
            textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)',
            fontWeight: 'bold' as const
        }
    }

    return (
        <AbsoluteFill
            style={{
                justifyContent: 'flex-end',
                alignItems: 'center',
                paddingBottom: '60px'
            }}
        >
            <div style={styles[style]}>
                {text}
            </div>
        </AbsoluteFill>
    )
}

export default VideoComposition
