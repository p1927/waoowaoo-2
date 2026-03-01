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
  imageUrl: string | null
}

interface StoryboardData {
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

export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  const { searchParams } = new URL(request.url)
  const episodeId = searchParams.get('episodeId')

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

  // Collect panels with images
  interface ImageItem {
    description: string
    imageUrl: string
    clipIndex: number
    panelIndex: number
  }
  const images: ImageItem[] = []

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
      if (panel.imageUrl) {
        images.push({
          description: panel.description || `Shot`,
          imageUrl: panel.imageUrl,
          clipIndex: clipIndex >= 0 ? clipIndex : 999,
          panelIndex: panel.panelIndex || 0
        })
      }
    }
  }

  // Sort by clipIndex and panelIndex
  images.sort((a, b) => {
    if (a.clipIndex !== b.clipIndex) {
      return a.clipIndex - b.clipIndex
    }
    return a.panelIndex - b.panelIndex
  })

  // Reassign consecutive global index
  const indexedImages = images.map((v, idx) => ({
    ...v,
    index: idx + 1
  }))

  if (indexedImages.length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  _ulogInfo(`Preparing to download ${indexedImages.length} images for project ${projectId}`)

  const archive = archiver('zip', { zlib: { level: 9 } })

  const stream = new ReadableStream({
    start(controller) {
      archive.on('data', (chunk) => controller.enqueue(chunk))
      archive.on('end', () => controller.close())
      archive.on('error', (err) => controller.error(err))
      processImages()
    }
  })

  async function processImages() {
    const isLocal = process.env.STORAGE_TYPE === 'local'

    for (const image of indexedImages) {
      try {
        _ulogInfo(`Downloading image ${image.index}: ${image.imageUrl}`)

        let imageData: Buffer
        let extension = 'png'
        const storageKey = await resolveStorageKeyFromMediaValue(image.imageUrl)

        if (image.imageUrl.startsWith('http://') || image.imageUrl.startsWith('https://')) {
          // External URL, download directly
          const response = await fetch(toFetchableUrl(image.imageUrl))
          if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`)
          }
          const arrayBuffer = await response.arrayBuffer()
          imageData = Buffer.from(arrayBuffer)

          const contentType = response.headers.get('content-type')
          if (contentType?.includes('jpeg') || contentType?.includes('jpg')) {
            extension = 'jpg'
          } else if (contentType?.includes('webp')) {
            extension = 'webp'
          }
        } else if (storageKey) {
          if (isLocal) {
            // Local: fetch via file API
            const { getSignedUrl } = await import('@/lib/cos')
            const localUrl = toFetchableUrl(getSignedUrl(storageKey))
            const response = await fetch(localUrl)
            if (!response.ok) {
              throw new Error(`Failed to fetch local file: ${response.statusText}`)
            }
            imageData = Buffer.from(await response.arrayBuffer())
          } else {
            // COS: download from COS
            const cos = getCOSClient()
            imageData = await new Promise<Buffer>((resolve, reject) => {
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

          const keyExt = storageKey.split('.').pop()?.toLowerCase()
          if (keyExt && ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(keyExt)) {
            extension = keyExt === 'jpeg' ? 'jpg' : keyExt
          }
        } else {
          const response = await fetch(toFetchableUrl(image.imageUrl))
          if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.statusText}`)
          }
          const arrayBuffer = await response.arrayBuffer()
          imageData = Buffer.from(arrayBuffer)
        }

        // Filename from description, sanitize
        const safeDesc = image.description.slice(0, 50).replace(/[\\/:*?"<>|]/g, '_')
        const fileName = `${String(image.index).padStart(3, '0')}_${safeDesc}.${extension}`
        archive.append(imageData, { name: fileName })
        _ulogInfo(`Added ${fileName} to archive`)
      } catch (error) {
        _ulogError(`Failed to download image ${image.index}:`, error)
      }
    }

    await archive.finalize()
    _ulogInfo('Archive finalized')
  }

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(project.name)}_images.zip"`
    }
  })
})
