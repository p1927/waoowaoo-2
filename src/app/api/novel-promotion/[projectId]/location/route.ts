import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { removeLocationPromptSuffix } from '@/lib/constants'
import { requireProjectAuth, requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

// Delete location（级联删除关联的图片记录）
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const locationId = searchParams.get('id')

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // Delete location（LocationImage 会级联删除）
  await prisma.novelPromotionLocation.delete({
    where: { id: locationId }
  })

  return NextResponse.json({ success: true })
})

// 新增场景
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { novelData } = authResult

  const body = await request.json()
  const taskLocale = resolveTaskLocale(request, body)
  const bodyMeta = toObject((body as Record<string, unknown>).meta)
  const acceptLanguage = request.headers.get('accept-language') || ''
  const { name, description, artStyle } = body

  if (!name || !description) {
    throw new ApiError('INVALID_PARAMS')
  }

  // If artStyle provided, update project artStylePrompt
  if (artStyle) {
    const ART_STYLES = [
      { value: 'american-comic', prompt: 'American comic style' },
      { value: 'chinese-comic', prompt: 'Refined comic style' },
      { value: 'anime', prompt: 'Anime style' },
      { value: 'realistic', prompt: 'Photorealistic style' }
    ]
    const style = ART_STYLES.find(s => s.value === artStyle)
    if (style) {
      await prisma.novelPromotionProject.update({
        where: { id: novelData.id },
        data: { artStylePrompt: style.prompt }
      })
    }
  }

  // Create location
  const cleanDescription = removeLocationPromptSuffix(description.trim())
  const location = await prisma.novelPromotionLocation.create({
    data: {
      novelPromotionProjectId: novelData.id,
      name: name.trim(),
      summary: body.summary?.trim() || null
    }
  })

  // Create initial image record
  await prisma.locationImage.create({
    data: {
      locationId: location.id,
      imageIndex: 0,
      description: cleanDescription
    }
  })

  // 触发后台图片生成
  const { getBaseUrl } = await import('@/lib/env')
  const baseUrl = getBaseUrl()
  fetch(`${baseUrl}/api/novel-promotion/${projectId}/generate-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': request.headers.get('cookie') || '',
      ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {}),
    },
    body: JSON.stringify({
      type: 'location',
      id: location.id,
      locale: taskLocale || undefined,
      meta: {
        ...bodyMeta,
        locale: taskLocale || bodyMeta.locale || undefined,
      },
    })
  }).catch(err => {
    _ulogError('[Location API] 后台图片生成任务触发failed:', err)
  })

  // 返回包含图片的场景数据
  const locationWithImages = await prisma.novelPromotionLocation.findUnique({
    where: { id: location.id },
    include: { images: true }
  })

  return NextResponse.json({ success: true, location: locationWithImages })
})

// Update location（名字或图片描述）
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // Auth check
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { locationId, imageIndex, description, name } = body

  if (!locationId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 如果提供了 name 或 summary，Update location信息
  if (name !== undefined || body.summary !== undefined) {
    const updateData: { name?: string; summary?: string | null } = {}
    if (name !== undefined) updateData.name = name.trim()
    if (body.summary !== undefined) updateData.summary = body.summary?.trim() || null

    const location = await prisma.novelPromotionLocation.update({
      where: { id: locationId },
      data: updateData
    })
    return NextResponse.json({ success: true, location })
  }

  // If description and imageIndex provided, update image description
  if (imageIndex !== undefined && description) {
    const cleanDescription = removeLocationPromptSuffix(description.trim())
    const image = await prisma.locationImage.update({
      where: {
        locationId_imageIndex: { locationId, imageIndex }
      },
      data: { description: cleanDescription }
    })
    return NextResponse.json({ success: true, image })
  }

  throw new ApiError('INVALID_PARAMS')
})
