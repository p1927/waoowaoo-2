import { type Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { type TaskJobData } from '@/lib/task/types'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'
import {
  assertTaskActive,
  getProjectModels,
  getUserModels,
  resolveImageSourceFromGeneration,
  stripLabelBar,
  toSignedUrlIfCos,
  uploadImageSourceToCos,
  withLabelBar,
} from '../utils'
import {
  normalizeReferenceImagesForGeneration,
  normalizeToBase64ForGeneration,
} from '@/lib/media/outbound-image'
import {
  AnyObj,
  parseImageUrls,
  pickFirstString,
  resolveNovelData,
} from './image-task-handler-shared'
import { executeAiVisionStep } from '@/lib/ai-runtime'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { createScopedLogger } from '@/lib/logging/core'

const logger = createScopedLogger({ module: 'worker.modify-asset-image' })

interface LocationImageRecord {
  id: string
  locationId: string
  imageUrl: string | null
  location: {
    name: string
  } | null
}

export async function handleModifyAssetImageTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const type = payload.type
  const modifyPrompt = payload.modifyPrompt

  if (!type || !modifyPrompt) {
    throw new Error('modify task missing type/modifyPrompt')
  }

  const projectModels = await getProjectModels(job.data.projectId, job.data.userId)
  const editModel = projectModels.editModel
  if (!editModel) throw new Error('Edit model not configured')

  // Read resolution from payload.generationOptions (injected by route layer buildImageBillingPayload)
  // Equivalent to legacy getModelResolution but data source changed to capabilityDefaults/capabilityOverrides
  const generationOptions = payload.generationOptions as Record<string, unknown> | undefined
  const resolution = typeof generationOptions?.resolution === 'string'
    ? generationOptions.resolution
    : undefined

  if (type === 'character') {
    const appearanceId = pickFirstString(payload.appearanceId, payload.targetId, job.data.targetId)
    if (!appearanceId) throw new Error('character appearance id missing')

    const appearance = await prisma.characterAppearance.findUnique({
      where: { id: appearanceId },
      include: { character: true },
    })
    if (!appearance) throw new Error('Character appearance not found')

    const imageIndex = Number(payload.imageIndex ?? appearance.selectedIndex ?? 0)
    const imageUrls = parseImageUrls(appearance.imageUrls, 'characterAppearance.imageUrls')
    const currentKey = imageUrls[imageIndex] || appearance.imageUrl
    const currentUrl = toSignedUrlIfCos(currentKey, 3600)
    if (!currentUrl) throw new Error('No image to modify')

    const requiredReference = await stripLabelBar(currentUrl)
    const extraReferenceInputs: string[] = []
    if (Array.isArray(payload.extraImageUrls)) {
      for (const url of payload.extraImageUrls) {
        if (typeof url === 'string' && url.trim().length > 0) {
          extraReferenceInputs.push(url.trim())
        }
      }
    }
    const normalizedExtras = await normalizeReferenceImagesForGeneration(extraReferenceInputs)
    const referenceImages = Array.from(new Set([requiredReference, ...normalizedExtras]))

    const prompt = `Modify the image according to the following instructions, keeping the character's core features consistent:\n${modifyPrompt}`
    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: editModel,
      prompt,
      options: {
        referenceImages,
        aspectRatio: '3:2',
        ...(resolution ? { resolution } : {}),
      },
    })

    const label = `${appearance.character?.name || 'Character'} - ${appearance.changeReason || 'Appearance'}`
    const labeled = await withLabelBar(source, label)
    const cosKey = await uploadImageSourceToCos(labeled, 'character-modify', appearance.id)

    while (imageUrls.length <= imageIndex) imageUrls.push('')
    imageUrls[imageIndex] = cosKey

    const selectedIndex = appearance.selectedIndex
    const shouldUpdateMain = selectedIndex === imageIndex || (selectedIndex === null && imageIndex === 0) || imageUrls.length === 1

    // If reference images exist, try AI analysis to update description (background, does not affect main flow)
    let extractedDescription: string | undefined
    if (normalizedExtras.length > 0) {
      try {
        const userModels = await getUserModels(job.data.userId)
        const analysisModel = userModels.analysisModel
        if (analysisModel) {
          const completion = await executeAiVisionStep({
            userId: job.data.userId,
            model: analysisModel,
            prompt: buildPrompt({ promptId: PROMPT_IDS.CHARACTER_IMAGE_TO_DESCRIPTION, locale: job.data.locale }),
            imageUrls: normalizedExtras,
            temperature: 0.3,
            projectId: job.data.projectId,
          })
          extractedDescription = completion.text || undefined
        }
      } catch (err) {
        logger.warn({ message: 'Reference image description extraction failed, does not affect edit result', details: { error: String(err) } })
      }
    }

    await assertTaskActive(job, 'persist_character_modify')
    await prisma.characterAppearance.update({
      where: { id: appearance.id },
      data: {
        previousImageUrl: appearance.imageUrl || null,
        previousImageUrls: appearance.imageUrls,
        previousDescription: appearance.description || null,
        imageUrls: encodeImageUrls(imageUrls),
        imageUrl: shouldUpdateMain ? cosKey : appearance.imageUrl,
        ...(extractedDescription ? { description: extractedDescription } : {}),
      },
    })

    return { type, appearanceId: appearance.id, imageIndex, imageUrl: cosKey }
  }

  if (type === 'location') {
    const locationImageId = pickFirstString(payload.locationImageId, payload.targetId, job.data.targetId)
    let locationImage: LocationImageRecord | null = locationImageId
      ? await prisma.locationImage.findUnique({
        where: { id: locationImageId },
        include: { location: true },
      }) as unknown as LocationImageRecord | null
      : null

    const payloadLocationId = typeof payload.locationId === 'string' ? payload.locationId : null
    if (!locationImage && payloadLocationId) {
      locationImage = await prisma.locationImage.findFirst({
        where: { locationId: payloadLocationId, imageIndex: Number(payload.imageIndex ?? 0) },
        include: { location: true },
      }) as unknown as LocationImageRecord | null
    }

    if (!locationImage || !locationImage.imageUrl) {
      throw new Error('Location image not found')
    }

    const currentUrl = toSignedUrlIfCos(locationImage.imageUrl, 3600)
    if (!currentUrl) throw new Error('No location image url')

    const requiredReference = await stripLabelBar(currentUrl)
    const extraReferenceInputs: string[] = []
    if (Array.isArray(payload.extraImageUrls)) {
      for (const url of payload.extraImageUrls) {
        if (typeof url === 'string' && url.trim().length > 0) {
          extraReferenceInputs.push(url.trim())
        }
      }
    }
    const normalizedExtras = await normalizeReferenceImagesForGeneration(extraReferenceInputs)
    const referenceImages = Array.from(new Set([requiredReference, ...normalizedExtras]))

    const prompt = `Modify the location image according to the following instructions, keeping the overall style consistent:\n${modifyPrompt}`
    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: editModel,
      prompt,
      options: {
        referenceImages,
        aspectRatio: '1:1',
        ...(resolution ? { resolution } : {}),
      },
    })

    const label = locationImage.location?.name || 'Location'
    const labeled = await withLabelBar(source, label)
    const cosKey = await uploadImageSourceToCos(labeled, 'location-modify', locationImage.id)

    await assertTaskActive(job, 'persist_location_modify')
    await prisma.locationImage.update({
      where: { id: locationImage.id },
      data: {
        previousImageUrl: locationImage.imageUrl,
        imageUrl: cosKey,
      },
    })

    return { type, locationImageId: locationImage.id, imageUrl: cosKey }
  }

  if (type === 'storyboard') {
    const panelId = pickFirstString(payload.panelId, payload.targetId, job.data.targetId)
    let panel = panelId
      ? await prisma.novelPromotionPanel.findUnique({
        where: { id: panelId },
        select: {
          id: true,
          storyboardId: true,
          panelIndex: true,
          imageUrl: true,
          previousImageUrl: true,
        },
      })
      : null

    const storyboardId = pickFirstString(payload.storyboardId)
    if (!panel && storyboardId && payload.panelIndex !== undefined) {
      panel = await prisma.novelPromotionPanel.findFirst({
        where: {
          storyboardId,
          panelIndex: Number(payload.panelIndex),
        },
        select: {
          id: true,
          storyboardId: true,
          panelIndex: true,
          imageUrl: true,
          previousImageUrl: true,
        },
      })
    }

    if (!panel || !panel.imageUrl) {
      throw new Error('Storyboard panel image not found')
    }

    const currentUrl = toSignedUrlIfCos(panel.imageUrl, 3600)
    if (!currentUrl) throw new Error('No storyboard panel image url')

    const projectData = await resolveNovelData(job.data.projectId)
    if (!projectData.videoRatio) throw new Error('Project videoRatio not configured')
    const aspectRatio = projectData.videoRatio
    const requiredReference = await normalizeToBase64ForGeneration(currentUrl)
    const extraReferenceInputs: string[] = []

    const selectedAssets = Array.isArray(payload.selectedAssets)
      ? payload.selectedAssets
      : []
    for (const asset of selectedAssets) {
      if (!asset || typeof asset !== 'object') continue
      const assetImage = (asset as AnyObj).imageUrl
      if (typeof assetImage === 'string' && assetImage.trim()) {
        extraReferenceInputs.push(assetImage.trim())
      }
    }

    if (Array.isArray(payload.extraImageUrls)) {
      for (const url of payload.extraImageUrls) {
        if (typeof url === 'string' && url.trim().length > 0) {
          extraReferenceInputs.push(url.trim())
        }
      }
    }

    const normalizedExtras = await normalizeReferenceImagesForGeneration(extraReferenceInputs)
    const uniqueReferences = Array.from(new Set([requiredReference, ...normalizedExtras]))
    const prompt = `Modify the storyboard image according to the following instructions, keeping shot language and subject consistent:\n${modifyPrompt}`
    const source = await resolveImageSourceFromGeneration(job, {
      userId: job.data.userId,
      modelId: editModel,
      prompt,
      options: {
        referenceImages: uniqueReferences,
        aspectRatio,
        ...(resolution ? { resolution } : {}),
      },
    })

    const cosKey = await uploadImageSourceToCos(source, 'panel-modify', panel.id)

    await assertTaskActive(job, 'persist_storyboard_modify')
    await prisma.novelPromotionPanel.update({
      where: { id: panel.id },
      data: {
        previousImageUrl: panel.imageUrl || panel.previousImageUrl || null,
        imageUrl: cosKey,
        candidateImages: null,
      },
    })

    return {
      type,
      panelId: panel.id,
      imageUrl: cosKey,
    }
  }

  throw new Error(`Unsupported modify type: ${String(type)}`)
}
