import { logInfo as _ulogInfo, logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { addSignedUrlsToProject, deleteCOSObjects } from '@/lib/cos'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { logProjectAction } from '@/lib/logging/semantic'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

// GET - Get project details
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // Auth verification
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Fetch only basic project info, no mode-specific data
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      user: true
    }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // Update last accessed time (async, non-blocking)
  prisma.project.update({
    where: { id: projectId },
    data: { lastAccessedAt: new Date() }
  }).catch(err => _ulogError('Failed to update access time:', err))

  // This API returns only basic project info
  // Mode-specific data should be fetched via respective APIs (e.g. /api/novel-promotion/[projectId])
  const projectWithSignedUrls = addSignedUrlsToProject(project)

  return NextResponse.json({ project: projectWithSignedUrls })
})

// PATCH - Update project config
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // Auth verification
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session
  const body = await request.json()

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: true }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // Update project
  const updatedProject = await prisma.project.update({
    where: { id: projectId },
    data: body
  })

  logProjectAction(
    'UPDATE',
    session.user.id,
    session.user.name,
    projectId,
    updatedProject.name,
    { changes: body }
  )

  return NextResponse.json({ project: updatedProject })
})

/**
 * Collect all COS file keys for a project
 */
async function collectProjectCOSKeys(projectId: string): Promise<string[]> {
  const keys: string[] = []

  // Fetch NovelPromotionProject
  const novelPromotion = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      // Characters and appearance images
      characters: {
        include: {
          appearances: true
        }
      },
      // Locations and images
      locations: {
        include: {
          images: true
        }
      },
      // Episodes (with audio, storyboards, etc.)
      episodes: {
        include: {
          storyboards: {
            include: {
              panels: true
            }
          }
        }
      }
    }
  })

  if (!novelPromotion) return keys

  // 1. Collect character appearance images
  for (const character of novelPromotion.characters) {
    for (const appearance of character.appearances) {
      const key = await resolveStorageKeyFromMediaValue(appearance.imageUrl)
      if (key) keys.push(key)
    }
  }

  // 2. Collect location images
  for (const location of novelPromotion.locations) {
    for (const image of location.images) {
      const key = await resolveStorageKeyFromMediaValue(image.imageUrl)
      if (key) keys.push(key)
    }
  }

  // 3. Collect episode-related files
  for (const episode of novelPromotion.episodes) {
    // Audio files
    const audioKey = await resolveStorageKeyFromMediaValue(episode.audioUrl)
    if (audioKey) keys.push(audioKey)

    // Storyboard images
    for (const storyboard of episode.storyboards) {
      // Storyboard composite image
      const sbKey = await resolveStorageKeyFromMediaValue(storyboard.storyboardImageUrl)
      if (sbKey) keys.push(sbKey)

      // Candidate images (JSON array)
      if (storyboard.candidateImages) {
        try {
          const candidates = JSON.parse(storyboard.candidateImages)
          for (const url of candidates) {
            const key = await resolveStorageKeyFromMediaValue(url)
            if (key) keys.push(key)
          }
        } catch { }
      }

      // Panel table images and videos
      for (const panel of storyboard.panels) {
        const imgKey = await resolveStorageKeyFromMediaValue(panel.imageUrl)
        if (imgKey) keys.push(imgKey)

        const videoKey = await resolveStorageKeyFromMediaValue(panel.videoUrl)
        if (videoKey) keys.push(videoKey)
      }
    }
  }

  _ulogInfo(`[Project ${projectId}] Collected ${keys.length} COS files to delete`)
  return keys
}

// DELETE - Delete project (and clean up COS files)
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params
  // Auth verification
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const session = authResult.session

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { user: true }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // 1. First collect all COS file keys
  _ulogInfo(`[DELETE] Starting project deletion: ${project.name} (${projectId})`)
  const cosKeys = await collectProjectCOSKeys(projectId)

  // 2. 批量删除 COS 文件
  let cosResult = { success: 0, failed: 0 }
  if (cosKeys.length > 0) {
    _ulogInfo(`[DELETE] Deleting ${cosKeys.length} COS files...`)
    cosResult = await deleteCOSObjects(cosKeys)
  }

  // 3. Delete database records (cascade deletes all related data)
  await prisma.project.delete({
    where: { id: projectId }
  })

  logProjectAction(
    'DELETE',
    session.user.id,
    session.user.name,
    projectId,
    project.name,
    {
      projectName: project.name,
      cosFilesDeleted: cosResult.success,
      cosFilesFailed: cosResult.failed
    }
  )

  _ulogInfo(`[DELETE] Project deletion complete: ${project.name}`)
  _ulogInfo(`[DELETE] COS files: success ${cosResult.success}, failed ${cosResult.failed}`)

  return NextResponse.json({
    success: true,
    cosFilesDeleted: cosResult.success,
    cosFilesFailed: cosResult.failed
  })
})
