import { NextResponse } from 'next/server'
import { getUserCostSummary } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

/**
 * GET /api/user/costs
 * Get current user's cost summary across all projects
 */
export const GET = apiHandler(async () => {
  // Auth check
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const userId = session.user.id

  // Get user cost summary
  const costSummary = await getUserCostSummary(userId)

  // Get project names
  const projectIds = costSummary.byProject.map(p => p.projectId)
  const projects = await prisma.project.findMany({
    where: { id: { in: projectIds } },
    select: { id: true, name: true }
  })

  const projectMap = new Map(projects.map(p => [p.id, p.name]))

  // Merge project names
  const byProjectWithNames = costSummary.byProject.map(p => ({
    projectId: p.projectId,
    projectName: projectMap.get(p.projectId) || 'Unknown project',
    totalCost: p._sum.cost || 0,
    recordCount: p._count
  }))

  return NextResponse.json({
    userId,
    currency: BILLING_CURRENCY,
    total: costSummary.total,
    byProject: byProjectWithNames.sort((a, b) => b.totalCost - a.totalCost)
  })
})
