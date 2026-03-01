import { logInfo as _ulogInfo } from '@/lib/logging/core'
// Unique ID generated at server boot, used to detect server restarts
// This value changes on each server restart
export const SERVER_BOOT_ID = `boot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

_ulogInfo(`[Server] Boot ID: ${SERVER_BOOT_ID}`)
