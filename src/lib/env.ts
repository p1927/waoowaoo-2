/**
 * Environment configuration utilities
 * Centralized env var access for API calls, webhooks, etc.
 */

/**
 * Get application baseUrl
 * Used for internal API calls, webhook callbacks, etc.
 */
export function getBaseUrl(): string {
    return process.env.NEXTAUTH_URL || 'http://localhost:3000'
}

/**
 * Get full API URL
 * @param path API path, e.g. '/api/user/balance'
 */
export function getApiUrl(path: string): string {
    const baseUrl = getBaseUrl()
    // Ensure path starts with /
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    return `${baseUrl}${normalizedPath}`
}
