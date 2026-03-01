import { logError as _ulogError } from '@/lib/logging/core'
/**
 * API Key encrypt/decrypt utilities
 *
 * Uses AES-256-GCM, key derived from NEXTAUTH_SECRET.
 * API keys entered on the web are stored encrypted in the database.
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 16
const KEY_LENGTH = 32
const SALT = 'waoowaoo-api-key-salt-v1' // Fixed salt

type ApiKeyObject = Record<string, unknown>

function isApiKeyObject(value: unknown): value is ApiKeyObject {
    return !!value && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Derive encryption key from env.
 * Prefer API_ENCRYPTION_KEY (fixed in open-source), fallback NEXTAUTH_SECRET.
 */
function deriveEncryptionKey(): Buffer {
    // Prefer dedicated encryption key (fixed value recommended for open-source)
    const secret = process.env.API_ENCRYPTION_KEY || process.env.NEXTAUTH_SECRET

    if (!secret) {
        throw new Error('API_ENCRYPTION_KEY or NEXTAUTH_SECRET not set; cannot encrypt API Key')
    }

    // PBKDF2 to derive 32-byte key; 100k iterations
    return crypto.pbkdf2Sync(secret, SALT, 100000, KEY_LENGTH, 'sha256')
}

/**
 * Encrypt API Key
 *
 * @param plaintext Plain API Key (user input)
 * @returns Encrypted string (format: iv:authTag:encrypted, all hex)
 *
 * @example
 * const encrypted = encryptApiKey('sk-or-v1-abc123...')
 * // Returns: "a1b2c3d4e5f6....:d7e8f9a0b1c2....:1234567890ab...."
 */
export function encryptApiKey(plaintext: string): string {
    if (!plaintext || plaintext.trim() === '') {
        throw new Error('API Key cannot be empty')
    }

    const key = deriveEncryptionKey()
    const iv = crypto.randomBytes(IV_LENGTH)

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv)

    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ])

    const authTag = cipher.getAuthTag()

    // Format: iv:authTag:encrypted (hex)
    return [
        iv.toString('hex'),
        authTag.toString('hex'),
        encrypted.toString('hex')
    ].join(':')
}

/**
 * 解密 API Key
 * 
 * @param ciphertext 加密后的字符串（encryptApiKey 的返回值）
 * @returns 明文 API Key
 * 
 * @example
 * const decrypted = decryptApiKey('a1b2c3d4e5f6....:d7e8f9a0b1c2....:1234567890ab....')
 * // 返回: "sk-or-v1-abc123..."
 */
export function decryptApiKey(ciphertext: string): string {
    if (!ciphertext || ciphertext.trim() === '') {
        throw new Error('加密数据不能为空')
    }

    const parts = ciphertext.split(':')
    if (parts.length !== 3) {
        throw new Error('加密数据格式错误')
    }

    const [ivHex, authTagHex, encryptedHex] = parts

    const key = deriveEncryptionKey()
    const iv = Buffer.from(ivHex, 'hex')
    const authTag = Buffer.from(authTagHex, 'hex')
    const encrypted = Buffer.from(encryptedHex, 'hex')

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
    decipher.setAuthTag(authTag)

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ])

    return decrypted.toString('utf8')
}

/**
 * 批量加密 API Key 对象
 * 
 * @param apiKeys 对象，key 为服务名，value 为对象（包含 apiKey 等字段）
 * @returns 加密后的字符串（JSON 格式）
 * 
 * @example
 * const encrypted = encryptApiKeyObject({
 *   google: { apiKey: 'abc123' },
 *   fal: { apiKey: 'xyz789' }
 * })
 */
export function encryptApiKeyObject(apiKeys: ApiKeyObject): string {
    const encrypted: ApiKeyObject = {}

    for (const [provider, config] of Object.entries(apiKeys)) {
        if (isApiKeyObject(config)) {
            const encryptedConfig: ApiKeyObject = { ...config }

            // 加密所有包含 'key' 或 'secret' 的字段
            for (const [key, value] of Object.entries(config)) {
                if (typeof value === 'string' && value.trim() !== '') {
                    const lowerKey = key.toLowerCase()
                    if (lowerKey.includes('key') || lowerKey.includes('secret')) {
                        encryptedConfig[key] = encryptApiKey(value)
                    }
                }
            }
            encrypted[provider] = encryptedConfig
        }
    }

    return JSON.stringify(encrypted)
}

/**
 * 批量解密 API Key 对象
 * 
 * @param encryptedJson 加密后的 JSON 字符串
 * @returns 解密后的对象
 */
export function decryptApiKeyObject(encryptedJson: string): ApiKeyObject {
    if (!encryptedJson || encryptedJson.trim() === '') {
        return {}
    }

    try {
        const encrypted = JSON.parse(encryptedJson) as unknown
        if (!isApiKeyObject(encrypted)) {
            return {}
        }
        const decrypted: ApiKeyObject = {}

        for (const [provider, config] of Object.entries(encrypted)) {
            if (isApiKeyObject(config)) {
                const decryptedConfig: ApiKeyObject = { ...config }

                // 解密所有包含 'key' 或 'secret' 的字段
                for (const [key, value] of Object.entries(config)) {
                    if (typeof value === 'string' && value.trim() !== '') {
                        const lowerKey = key.toLowerCase()
                        if (lowerKey.includes('key') || lowerKey.includes('secret')) {
                            try {
                                decryptedConfig[key] = decryptApiKey(value)
                            } catch (error) {
                                _ulogError(`解密 ${provider}.${key} 失败:`, error)
                                // 如果解密失败，保持原值（可能是明文）
                                decryptedConfig[key] = value
                            }
                        }
                    }
                }
                decrypted[provider] = decryptedConfig
            }
        }

        return decrypted
    } catch (error) {
        _ulogError('解密 API Key 对象失败:', error)
        return {}
    }
}
