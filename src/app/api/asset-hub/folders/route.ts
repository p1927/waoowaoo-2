import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { ApiError, apiHandler } from '@/lib/api-errors'

// 获取用户所有文件夹
export const GET = apiHandler(async () => {
    // Auth check
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const folders = await prisma.globalAssetFolder.findMany({
        where: { userId: session.user.id },
        orderBy: { name: 'asc' }
    })

    return NextResponse.json({ folders })
})

// Create folder
export const POST = apiHandler(async (request: NextRequest) => {
    // Auth check
    const authResult = await requireUserAuth()
    if (isErrorResponse(authResult)) return authResult
    const { session } = authResult

    const body = await request.json()
    const { name } = body

    if (!name?.trim()) {
        throw new ApiError('INVALID_PARAMS')
    }

    const folder = await prisma.globalAssetFolder.create({
        data: {
            userId: session.user.id,
            name: name.trim()
        }
    })

    return NextResponse.json({ success: true, folder })
})
