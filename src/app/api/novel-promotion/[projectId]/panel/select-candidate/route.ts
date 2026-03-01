import { logInfo as _ulogInfo } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSignedUrl, generateUniqueKey, downloadAndUploadToCOS, toFetchableUrl } from '@/lib/cos'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'

interface PanelHistoryEntry {
  url: string
  timestamp: string
}

function parseUnknownArray(jsonValue: string | null): unknown[] {
  if (!jsonValue) return []
  try {
    const parsed = JSON.parse(jsonValue)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parsePanelHistory(jsonValue: string | null): PanelHistoryEntry[] {
  return parseUnknownArray(jsonValue).filter((entry): entry is PanelHistoryEntry => {
    if (!entry || typeof entry !== 'object') return false
    const candidate = entry as { url?: unknown; timestamp?: unknown }
    return typeof candidate.url === 'string' && typeof candidate.timestamp === 'string'
  })
}

/**
 * POST /api/novel-promotion/[projectId]/panel/select-candidate
 * Unified candidate image operation API
 *
 * action: 'select' - Select candidate image as final image
 * action: 'cancel' - Cancel selection, clear candidate list
 */
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth verification
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { panelId, selectedImageUrl, action = 'select' } = body

  if (!panelId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // === Cancel action ===
  if (action === 'cancel') {
    await prisma.novelPromotionPanel.update({
      where: { id: panelId },
      data: { candidateImages: null }
    })

    return NextResponse.json({
      success: true,
      message: 'Selection cancelled'
    })
  }

  // === Select action ===
  if (!selectedImageUrl) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Fetch Panel
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId }
  })

  if (!panel) {
    throw new ApiError('NOT_FOUND')
  }

  // Verify selected image is in candidate list
  const candidateImages = parseUnknownArray(panel.candidateImages)

  const selectedCosKey = await resolveStorageKeyFromMediaValue(selectedImageUrl)
  const candidateKeys = (await Promise.all(candidateImages.map((candidate: unknown) => resolveStorageKeyFromMediaValue(candidate))))
    .filter((k): k is string => !!k)
  const isValidCandidate = !!selectedCosKey && candidateKeys.includes(selectedCosKey)

  if (!isValidCandidate) {
    _ulogInfo(
      `[select-candidate] Select failed: selectedCosKey=${selectedCosKey}, candidateKeys=${JSON.stringify(candidateKeys)}, candidateImages=${JSON.stringify(candidateImages)}`,
    )
    throw new ApiError('INVALID_PARAMS')
  }

  // Save current image to history
  const currentHistory = parsePanelHistory(panel.imageHistory)
  if (panel.imageUrl) {
    currentHistory.push({
      url: panel.imageUrl,
      timestamp: new Date().toISOString()
    })
  }

  // When selecting candidate, prefer reusing existing COS key to avoid re-download/upload (and /m/* relative URL Node fetch parse failure)
  let finalImageKey = selectedCosKey as string
  const isReusableKey = !finalImageKey.startsWith('http://') && !finalImageKey.startsWith('https://') && !finalImageKey.startsWith('/')

  if (!isReusableKey) {
    const sourceUrl = toFetchableUrl(selectedImageUrl)
    const cosKey = generateUniqueKey(`panel-${panelId}-selected`, 'png')
    finalImageKey = await downloadAndUploadToCOS(sourceUrl, cosKey)
  }

  const signedUrl = getSignedUrl(finalImageKey, 7 * 24 * 3600)

  // Update Panel: set new image, clear candidate list
  await prisma.novelPromotionPanel.update({
    where: { id: panelId },
    data: {
      imageUrl: finalImageKey,
      imageHistory: JSON.stringify(currentHistory),
      candidateImages: null
    }
  })

  return NextResponse.json({
    success: true,
    imageUrl: signedUrl,
    cosKey: finalImageKey,
    message: 'Image selected'
  })
})
