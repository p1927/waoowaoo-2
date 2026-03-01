import { logError as _ulogError } from '@/lib/logging/core'
/**
 * Local file service API
 * 
 * Only when STORAGE_TYPE=local
 * Serves local files over HTTP
 */

import { NextRequest, NextResponse } from 'next/server'
import * as fs from 'fs/promises'
import * as path from 'path'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads'

// MIME type map
const MIME_TYPES: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.json': 'application/json',
    '.txt': 'text/plain',
}

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase()
    return MIME_TYPES[ext] || 'application/octet-stream'
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ path: string[] }> }
) {
    try {
        const { path: pathSegments } = await params

        // Decode path (URL-encoded)
        const decodedPath = decodeURIComponent(pathSegments.join('/'))
        const filePath = path.join(process.cwd(), UPLOAD_DIR, decodedPath)

        // Security: path must not escape upload dir
        const normalizedPath = path.normalize(filePath)
        const uploadDirPath = path.normalize(path.join(process.cwd(), UPLOAD_DIR))

        if (!normalizedPath.startsWith(uploadDirPath + path.sep)) {
            _ulogError(`[Files API] Path escape attempt: ${decodedPath}`)
            return NextResponse.json({ error: 'Access denied' }, { status: 403 })
        }

        // Read file
        const buffer = await fs.readFile(filePath)
        const mimeType = getMimeType(filePath)

        // Return file content
        return new NextResponse(new Uint8Array(buffer), {
            status: 200,
            headers: {
                'Content-Type': mimeType,
                'Content-Length': buffer.length.toString(),
                'Cache-Control': 'public, max-age=31536000', // 1 year cache
            },
        })

    } catch (error: unknown) {
        const code = typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code?: unknown }).code
            : undefined
        if (code === 'ENOENT') {
            return NextResponse.json({ error: 'File not found' }, { status: 404 })
        }

        _ulogError('[Files API] Read file failed:', error)
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
    }
}
