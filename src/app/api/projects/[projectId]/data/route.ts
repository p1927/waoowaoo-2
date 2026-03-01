import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'

/**
 * Unified project data loading API
 * Returns project base info, global config, global assets and episode list
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth verification
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Fetch base project info
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

  // Update last accessed time (async, non-blocking)
  prisma.project.update({
    where: { id: projectId },
    data: { lastAccessedAt: new Date() }
  }).catch(err => _ulogError('Failed to update access time:', err))

  // Parallel: load novel-promotion data
  // Note: characters/locations are lazy-loaded, first fetch only episodes list
  const novelPromotionData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      // Episode list (base info) - required for home page
      episodes: {
        orderBy: { episodeNumber: 'asc' }
      },
      // Characters and locations - required for asset display
      characters: {
        include: {
          appearances: true
        },
        orderBy: { createdAt: 'asc' }
      },
      locations: {
        include: {
          images: true
        },
        orderBy: { createdAt: 'asc' }
      }
    }
  })

  if (!novelPromotionData) {
    throw new ApiError('NOT_FOUND')
  }

  // Convert to stable media URLs (preserve compatible fields)
  const novelPromotionDataWithSignedUrls = await attachMediaFieldsToProject(novelPromotionData)

  const fullProject = {
    ...project,
    novelPromotionData: novelPromotionDataWithSignedUrls
    // No longer override any fields with userPreference
    // editModel etc. should use values from novelPromotionData directly
  }

  return NextResponse.json({ project: fullProject })
})
