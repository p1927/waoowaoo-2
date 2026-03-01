import { logError as _ulogError } from '@/lib/logging/core'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuth, requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { PRIMARY_APPEARANCE_INDEX } from '@/lib/constants'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'

function toObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

// 更新角色信息（名字或介绍）
export const PATCH = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json()
  const { characterId, name, introduction } = body

  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  if (!name && introduction === undefined) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 构建更新数据
  const updateData: { name?: string; introduction?: string } = {}
  if (name) updateData.name = name.trim()
  if (introduction !== undefined) updateData.introduction = introduction.trim()

  // 更新角色
  const character = await prisma.novelPromotionCharacter.update({
    where: { id: characterId },
    data: updateData
  })

  return NextResponse.json({ success: true, character })
})

// 删除角色（级联删除关联的形象记录）
export const DELETE = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const { searchParams } = new URL(request.url)
  const characterId = searchParams.get('id')

  if (!characterId) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 删除角色（CharacterAppearance 会级联删除）
  await prisma.novelPromotionCharacter.delete({
    where: { id: characterId }
  })

  return NextResponse.json({ success: true })
})

// 新增角色
export const POST = apiHandler(async (
  request: NextRequest,
  context: { params: Promise<{ projectId: string }> }
) => {
  const { projectId } = await context.params

  // 🔐 统一权限验证
  const authResult = await requireProjectAuth(projectId)
  if (isErrorResponse(authResult)) return authResult
  const { novelData } = authResult

  const body = await request.json()
  const taskLocale = resolveTaskLocale(request, body)
  const bodyMeta = toObject((body as Record<string, unknown>).meta)
  const acceptLanguage = request.headers.get('accept-language') || ''
  const {
    name,
    description,
    referenceImageUrl,
    referenceImageUrls,
    generateFromReference,
    artStyle,
    customDescription  // 🔥 新增：文生图模式使用的自定义描述
  } = body

  if (!name) {
    throw new ApiError('INVALID_PARAMS')
  }

  // 🔥 支持多张参考图（最多 5 张），兼容单张旧格式
  let allReferenceImages: string[] = []
  if (referenceImageUrls && Array.isArray(referenceImageUrls)) {
    allReferenceImages = referenceImageUrls.slice(0, 5)
  } else if (referenceImageUrl) {
    allReferenceImages = [referenceImageUrl]
  }

  // 创建角色
  const character = await prisma.novelPromotionCharacter.create({
    data: {
      novelPromotionProjectId: novelData.id,
      name: name.trim(),
      aliases: null
    }
  })

  // 创建初始形象（独立表）
  const descText = description?.trim() || `Character setting for ${name.trim()}`
  const appearance = await prisma.characterAppearance.create({
    data: {
      characterId: character.id,
      appearanceIndex: PRIMARY_APPEARANCE_INDEX,
      changeReason: 'Initial appearance',
      description: descText,
      descriptions: JSON.stringify([descText]),
      imageUrls: encodeImageUrls([]),
      previousImageUrls: encodeImageUrls([])}
  })

  if (generateFromReference && allReferenceImages.length > 0) {
    const { getBaseUrl } = await import('@/lib/env')
    const baseUrl = getBaseUrl()
    fetch(`${baseUrl}/api/novel-promotion/${projectId}/reference-to-character`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || '',
        ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {})
      },
      body: JSON.stringify({
        referenceImageUrls: allReferenceImages,
        characterName: name.trim(),
        characterId: character.id,
        appearanceId: appearance.id,
        isBackgroundJob: true,
        artStyle: artStyle || 'american-comic',
        customDescription: customDescription || undefined,  // 🔥 传递自定义描述（文生图模式）
        locale: taskLocale || undefined,
        meta: {
          ...bodyMeta,
          locale: taskLocale || bodyMeta.locale || undefined,
        },
      })
    }).catch(err => {
      _ulogError('[Character API] 参考图后台生成任务触发失败:', err)
    })
  } else if (description?.trim()) {
    // 普通创建：触发后台图片生成
    const { getBaseUrl } = await import('@/lib/env')
    const baseUrl = getBaseUrl()
    fetch(`${baseUrl}/api/novel-promotion/${projectId}/generate-character-image`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': request.headers.get('cookie') || '',
        ...(acceptLanguage ? { 'Accept-Language': acceptLanguage } : {})
      },
      body: JSON.stringify({
        characterId: character.id,
        appearanceIndex: PRIMARY_APPEARANCE_INDEX,
        artStyle: artStyle || 'american-comic',
        locale: taskLocale || undefined,
        meta: {
          ...bodyMeta,
          locale: taskLocale || bodyMeta.locale || undefined,
        },
      })
    }).catch(err => {
      _ulogError('[Character API] 后台图片生成任务触发失败:', err)
    })
  }

  // 返回包含形象的角色数据
  const characterWithAppearances = await prisma.novelPromotionCharacter.findUnique({
    where: { id: character.id },
    include: { appearances: true }
  })

  return NextResponse.json({ success: true, character: characterWithAppearances })
})
