import { NextRequest, NextResponse } from 'next/server'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'

const NOT_IMPLEMENTED_RESPONSE = {
  error: 'VIDEO_RENDER_NOT_IMPLEMENTED',
  message: 'Server-side video rendering is not yet available. Use the download endpoint to get individual panel videos.',
} as const

/**
 * POST /api/novel-promotion/[projectId]/editor/render
 * Start render export (not yet implemented)
 */
export const POST = apiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  return NextResponse.json(NOT_IMPLEMENTED_RESPONSE, { status: 501 })
})

/**
 * GET /api/novel-promotion/[projectId]/editor/render?id=xxx
 * Get render status (not yet implemented)
 */
export const GET = apiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await params
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  return NextResponse.json(NOT_IMPLEMENTED_RESPONSE, { status: 501 })
})
