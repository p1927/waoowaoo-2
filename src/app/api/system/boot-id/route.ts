import { NextResponse } from 'next/server'
import { SERVER_BOOT_ID } from '@/lib/server-boot'

/**
 * GET /api/system/boot-id
 * Returns server boot ID for detecting server restart
 */
export async function GET() {
    return NextResponse.json({ bootId: SERVER_BOOT_ID })
}
