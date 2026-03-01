import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import archiver from 'archiver'
import { getCOSClient, toFetchableUrl } from '@/lib/cos'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
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

export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Parse request body
  const body = await request.json()
  const { episodeId, panelPreferences } = body as {
    episodeId?: string
    panelPreferences?: Record<string, boolean>  // key: panelKey, value: true=lip-sync, false=original
  }

  // Auth check
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { project } = authResult

  // Get data by episodeId or all
  let episodes: EpisodeData[] = []

  if (episodeId) {
    // Get specified episode only
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
    // Get all episodes
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

  // Collect panels with video
  interface VideoItem {
    description: string
    videoUrl: string
    clipIndex: number  // Use clip index in array
    panelIndex: number
    isLipSync?: boolean  // Whether lip-sync video
  }
  const videos: VideoItem[] = []

  // Get storyboards and clips from episodes
  const allStoryboards: StoryboardData[] = []
  const allClips: ClipData[] = []
  for (const episode of episodes) {
    allStoryboards.push(...(episode.storyboards || []))
    allClips.push(...(episode.clips || []))
  }

  // Iterate all storyboards and panels
  for (const storyboard of allStoryboards) {
    // Sort by clip index in clips array
    const clipIndex = allClips.findIndex((clip) => clip.id === storyboard.clipId)

    // Use standalone Panel record
    const panels = storyboard.panels || []
    for (const panel of panels) {
      // Build panelKey for preference lookup
      const panelKey = `${storyboard.id}-${panel.panelIndex || 0}`
      // Get panel preference, default true (lip-sync)
      const preferLipSync = panelPreferences?.[panelKey] ?? true

      // Pick video type by user preference
      let videoUrl: string | null = null
      let isLipSync = false

      if (preferLipSync) {
        // Prefer lip-sync then original
        videoUrl = panel.lipSyncVideoUrl || panel.videoUrl
        isLipSync = !!panel.lipSyncVideoUrl
      } else {
        // Prefer original then lip-sync (fallback lip-sync if only that)
        videoUrl = panel.videoUrl || panel.lipSyncVideoUrl
        isLipSync = !panel.videoUrl && !!panel.lipSyncVideoUrl
      }

      if (videoUrl) {
        videos.push({
          description: panel.description || `Shot`,
          videoUrl: videoUrl,
          clipIndex: clipIndex >= 0 ? clipIndex : 999,  // When not found put last
          panelIndex: panel.panelIndex || 0,
          isLipSync
        })
      }
    }
  }

  // Sort by clipIndex and panelIndex
  videos.sort((a, b) => {
    if (a.clipIndex !== b.clipIndex) {
      return a.clipIndex - b.clipIndex
    }
    return a.panelIndex - b.panelIndex
  })

  // Reassign consecutive global index
  const indexedVideos = videos.map((v, idx) => ({
    ...v,
    index: idx + 1
  }))

  if (indexedVideos.length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  _ulogInfo(`Preparing to download ${indexedVideos.length} videos for project ${projectId}`)

  const archive = archiver('zip', { zlib: { level: 9 } })

  // Promise to track archive completion
  const archiveFinished = new Promise<void>((resolve, reject) => {
    archive.on('end', () => resolve())
    archive.on('error', (err) => {
      reject(err)
    })
  })

  // Use PassThrough stream to collect data
  const chunks: Uint8Array[] = []
  archive.on('data', (chunk) => {
    chunks.push(chunk)
  })

  // Process video and pack
  const isLocal = process.env.STORAGE_TYPE === 'local'

  for (const video of indexedVideos) {
    try {
      _ulogInfo(`Downloading video ${video.index}: ${video.videoUrl}`)

      let videoData: Buffer
      const storageKey = await resolveStorageKeyFromMediaValue(video.videoUrl)

      if (video.videoUrl.startsWith('http://') || video.videoUrl.startsWith('https://')) {
        const response = await fetch(toFetchableUrl(video.videoUrl))
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`)
        }
        const arrayBuffer = await response.arrayBuffer()
        videoData = Buffer.from(arrayBuffer)
      } else if (storageKey) {
        if (isLocal) {
          const { getSignedUrl } = await import('@/lib/cos')
          const localUrl = toFetchableUrl(getSignedUrl(storageKey))
          const response = await fetch(localUrl)
          if (!response.ok) {
            throw new Error(`Failed to fetch local file: ${response.statusText}`)
          }
          videoData = Buffer.from(await response.arrayBuffer())
        } else {
          const cos = getCOSClient()
          videoData = await new Promise<Buffer>((resolve, reject) => {
            cos.getObject(
              {
                Bucket: process.env.COS_BUCKET!,
                Region: process.env.COS_REGION!,
                Key: storageKey
              },
              (err, data) => {
                if (err) reject(err)
                else resolve(data.Body as Buffer)
              }
            )
          })
        }
      } else {
        const response = await fetch(toFetchableUrl(video.videoUrl))
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`)
        }
        const arrayBuffer = await response.arrayBuffer()
        videoData = Buffer.from(arrayBuffer)
      }

      // Filename from description, sanitize
      const safeDesc = video.description.slice(0, 50).replace(/[\\/:*?"<>|]/g, '_')
      const fileName = `${String(video.index).padStart(3, '0')}_${safeDesc}.mp4`
      archive.append(videoData, { name: fileName })
      _ulogInfo(`Added ${fileName} to archive`)
    } catch (error) {
      _ulogError(`Failed to download video ${video.index}:`, error)
    }
  }

  // Archive complete
  await archive.finalize()
  _ulogInfo('Archive finalized')

  // Wait for archive
  await archiveFinished

  // Merge all chunks
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return new Response(result, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(project.name)}_videos.zip"`
    }
  })
})
