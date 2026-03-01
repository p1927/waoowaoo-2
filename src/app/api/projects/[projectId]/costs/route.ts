import { NextRequest, NextResponse } from 'next/server'
import { getProjectCostDetails } from '@/lib/billing'
import { BILLING_CURRENCY } from '@/lib/billing/currency'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

/**
 * GET /api/projects/[projectId]/costs
 * Get project cost details
 */
export const GET = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  // Auth verification
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { projectId } = await context.params

  // Verify project ownership
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { userId: true, name: true }
  })

  if (!project) {
    throw new ApiError('NOT_FOUND')
  }

  if (project.userId !== session.user.id) {
    throw new ApiError('FORBIDDEN')
  }

  // Fetch cost details
  const costDetails = await getProjectCostDetails(projectId)

  return NextResponse.json({
    projectId,
    projectName: project.name,
    currency: BILLING_CURRENCY,
    ...costDetails
  })
})
