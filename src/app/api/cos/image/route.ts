import { NextRequest, NextResponse } from 'next/server'
import { getSignedUrl, toFetchableUrl } from '@/lib/cos'
import { apiHandler, ApiError } from '@/lib/api-errors'

export const GET = apiHandler(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  if (!key) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Generate signed URL (1h TTL)
  const signedUrl = toFetchableUrl(getSignedUrl(key, 3600))

  // Redirect to signed URL
  return NextResponse.redirect(signedUrl)
})
