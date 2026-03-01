import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface PanelData {
    panelIndex: number | null
    description: string | null
    videoUrl: string | null
    lipSyncVideoUrl: string | null
}

interface StoryboardData {
    id: string
    clipId: string
    panels?: PanelData[]
}

interface ClipData {
    id: string
}

interface EpisodeData {
    storyboards?: StoryboardData[]
    clips?: ClipData[]
}

/**
 * Get video download URL list (no server-side download/pack)
 * For client direct download, avoids large file transfer
 */
export const POST = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // Parse request body
    const body = await request.json()
    const { episodeId, panelPreferences } = body as {
        episodeId?: string
        panelPreferences?: Record<string, boolean>  // key: panelKey, value: true=lip sync, false=original
    }

    // Auth verification
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult
    const project = authResult.project

    // Fetch data based on whether episodeId is specified
    let episodes: EpisodeData[] = []

    if (episodeId) {
        // Fetch only specified episode data
        const episode = await prisma.novelPromotionEpisode.findUnique({
            where: { id: episodeId },
            include: {
                storyboards: {
                    include: {
                        panels: { orderBy: { panelIndex: 'asc' } }
                    },
                    orderBy: { createdAt: 'asc' }
                },
                clips: {
                    orderBy: { createdAt: 'asc' }
                }
            }
        })
        if (episode) {
            episodes = [episode]
        }
    } else {
        // Fetch all episodes data
        const npData = await prisma.novelPromotionProject.findFirst({
            where: { projectId },
            include: {
                episodes: {
                    include: {
                        storyboards: {
                            include: {
                                panels: { orderBy: { panelIndex: 'asc' } }
                            },
                            orderBy: { createdAt: 'asc' }
                        },
                        clips: {
                            orderBy: { createdAt: 'asc' }
                        }
                    }
                }
            }
        })
        episodes = npData?.episodes || []
    }

    if (episodes.length === 0) {
        throw new ApiError('NOT_FOUND')
    }

    // Collect all panels with video
    interface VideoItem {
        fileName: string
        videoUrl: string  // Signed full URL
        clipIndex: number
        panelIndex: number
    }

    // Get all storyboards and clips from episodes
    const allStoryboards: StoryboardData[] = []
    const allClips: ClipData[] = []
    for (const episode of episodes) {
        allStoryboards.push(...(episode.storyboards || []))
        allClips.push(...(episode.clips || []))
    }

    interface VideoCandidate extends VideoItem {
        videoKey: string
        desc: string
    }
    const videoCandidates: VideoCandidate[] = []

    // Iterate all storyboards and panels
    for (const storyboard of allStoryboards) {
        const clipIndex = allClips.findIndex((clip) => clip.id === storyboard.clipId)

        const panels = storyboard.panels || []
        for (const panel of panels) {
            // Build panelKey for preference lookup
            const panelKey = `${storyboard.id}-${panel.panelIndex || 0}`
            const preferLipSync = panelPreferences?.[panelKey] ?? true

            // Select video type by user preference
            let videoKey: string | null = null

            if (preferLipSync) {
                videoKey = panel.lipSyncVideoUrl || panel.videoUrl
            } else {
                videoKey = panel.videoUrl || panel.lipSyncVideoUrl
            }

            if (videoKey) {
                // Use description for filename, sanitize invalid chars
                const safeDesc = (panel.description || 'shot').slice(0, 50).replace(/[\\/:*?"<>|]/g, '_')

                videoCandidates.push({
                    fileName: '',
                    videoUrl: '',
                    clipIndex: clipIndex >= 0 ? clipIndex : 999,
                    panelIndex: panel.panelIndex || 0,
                    videoKey,
                    desc: safeDesc})
            }
        }
    }

    // Sort by clipIndex and panelIndex
    videoCandidates.sort((a, b) => {
        if (a.clipIndex !== b.clipIndex) {
            return a.clipIndex - b.clipIndex
        }
        return a.panelIndex - b.panelIndex
    })

    // Reassign consecutive global indices and generate proxy URLs
    const result = videoCandidates.map((video, idx) => {
        const videoKey = video.videoKey
        const safeDesc = video.desc
        const index = idx + 1
        const fileName = `${String(index).padStart(3, '0')}_${safeDesc}.mp4`

        // Use proxy URL to avoid CORS
        const proxyUrl = `/api/novel-promotion/${projectId}/video-proxy?key=${encodeURIComponent(videoKey)}`

        return {
            index,
            fileName,
            videoUrl: proxyUrl
        }
    })

    if (result.length === 0) {
        throw new ApiError('INVALID_PARAMS')
    }

    return NextResponse.json({
        projectName: project.name,
        videos: result
    })
})
