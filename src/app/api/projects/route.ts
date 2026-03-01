import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { toMoneyNumber } from '@/lib/billing/money'

// GET - Get user's projects (with pagination and search)
export const GET = apiHandler(async (request: NextRequest) => {
  // Auth verification
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // Get query params
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = parseInt(searchParams.get('pageSize') || '12', 10)
  const search = searchParams.get('search') || ''

  // Build query conditions
  const where: Record<string, unknown> = { userId: session.user.id }

  // If search keyword exists, search name and description
  if (search.trim()) {
    where.OR = [
      { name: { contains: search.trim(), mode: 'insensitive' } },
      { description: { contains: search.trim(), mode: 'insensitive' } }
    ]
  }

  // Parallel: fetch total count + paginated data
  // Sort priority: last accessed time (non-null first) > updated time
  const [total, allProjects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },  // Order by updatedAt to get all matching projects
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ])

  // Re-sort at app layer:
  // 1. Newly created but unvisited projects (no lastAccessedAt) sorted by createdAt desc first
  // 2. Visited projects sorted by access time desc
  const projects = [...allProjects].sort((a, b) => {
    // Neither has access time, sort by createdAt desc (newer first)
    if (!a.lastAccessedAt && !b.lastAccessedAt) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }
    // Only a has no access time (newly created), a first
    if (!a.lastAccessedAt && b.lastAccessedAt) return -1
    // Only b has no access time (newly created), b first
    if (a.lastAccessedAt && !b.lastAccessedAt) return 1
    // Both have access time, sort by access time desc
    return new Date(b.lastAccessedAt!).getTime() - new Date(a.lastAccessedAt!).getTime()
  })

  // Get project IDs
  const projectIds = projects.map(p => p.id)

  // Parallel fetch: costs + project stats (episodes, images, videos)
  const [costsByProject, novelProjects] = await Promise.all([
    // Fetch all project costs in one query (avoid N+1)
    prisma.usageCost.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds } },
      _sum: { cost: true }
    }),
    // Fetch all project stats in one query
    prisma.novelPromotionProject.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        projectId: true,
        _count: {
          select: {
            episodes: true,
            characters: true,
            locations: true}
        },
        episodes: {
          orderBy: { episodeNumber: 'asc' },
          select: {
            episodeNumber: true,
            novelText: true,
            storyboards: {
              select: {
                _count: {
                  select: { panels: true }
                },
                panels: {
                  where: {
                    OR: [
                      { imageUrl: { not: null } },
                      { videoUrl: { not: null } },
                    ]
                  },
                  select: {
                    imageUrl: true,
                    videoUrl: true}
                }
              }
            }
          }
        }
      }
    })
  ])

  // Build cost map
  const costMap = new Map(
    costsByProject.map(item => [item.projectId, toMoneyNumber(item._sum.cost)])
  )

  // Build stats map + first episode preview
  const statsMap = new Map<string, { episodes: number; images: number; videos: number; panels: number; firstEpisodePreview: string | null }>(
    novelProjects.map(np => {
      let imageCount = 0
      let videoCount = 0
      let panelCount = 0
      for (const ep of np.episodes) {
        for (const sb of ep.storyboards) {
          panelCount += sb._count.panels
          for (const panel of sb.panels) {
            if (panel.imageUrl) imageCount++
            if (panel.videoUrl) videoCount++
          }
        }
      }
      // Use first episode novelText first 100 chars as preview
      const firstEp = np.episodes[0]
      const preview = firstEp?.novelText ? firstEp.novelText.slice(0, 100) : null
      return [np.projectId, {
        episodes: np._count.episodes,
        images: imageCount,
        videos: videoCount,
        panels: panelCount,
        firstEpisodePreview: preview}]
    })
  )

  // Merge projects, costs and stats
  const projectsWithStats = projects.map(project => ({
    ...project,
    totalCost: costMap.get(project.id) ?? 0,
    stats: statsMap.get(project.id) ?? { episodes: 0, images: 0, videos: 0, panels: 0, firstEpisodePreview: null }}))

  return NextResponse.json({
    projects: projectsWithStats,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  })
})

// POST - Create new project
export const POST = apiHandler(async (request: NextRequest) => {
  // Auth verification
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { name, description } = await request.json()

  if (!name || name.trim().length === 0) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (name.length > 100) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (description && description.length > 500) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Fetch user preference config
  const userPreference = await prisma.userPreference.findUnique({
    where: { userId: session.user.id }
  })

  // Create base project (mode fixed as novel-promotion)
  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      mode: 'novel-promotion',
      userId: session.user.id
    }
  })

  // Create novel-promotion data, use user preference as defaults
  // Note: no longer auto-create default episode; user decides at selection screen:
  // - Manual creation -> create first blank episode
  // - Smart import -> AI analyzes then batch creates episodes
  // artStylePrompt fetched via real-time query, not stored in DB
  await prisma.novelPromotionProject.create({
    data: {
      projectId: project.id,
      ...(userPreference && {
        analysisModel: userPreference.analysisModel,
        characterModel: userPreference.characterModel,
        locationModel: userPreference.locationModel,
        storyboardModel: userPreference.storyboardModel,
        editModel: userPreference.editModel,
        videoModel: userPreference.videoModel,
        videoRatio: userPreference.videoRatio,
        artStyle: userPreference.artStyle || 'american-comic',
        ttsRate: userPreference.ttsRate
      })
    }
  })

  return NextResponse.json({ project }, { status: 201 })
})
