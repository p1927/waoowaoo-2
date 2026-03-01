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
 * Decrypt API Key
 *
 * @param ciphertext Encrypted string (return value of encryptApiKey)
 * @returns Plain API Key
 *
 * @example
 * const decrypted = decryptApiKey('a1b2c3d4e5f6....:d7e8f9a0b1c2....:1234567890ab....')
 * // Returns: "sk-or-v1-abc123..."
 */
export function decryptApiKey(ciphertext: string): string {
    if (!ciphertext || ciphertext.trim() === '') {
        throw new Error('Encrypted data cannot be empty')
    }

    const parts = ciphertext.split(':')
    if (parts.length !== 3) {
        throw new Error('Encrypted data format invalid')
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
 * Encrypt API Key object (batch)
 *
 * @param apiKeys Object keyed by service name, values contain apiKey etc.
 * @returns Encrypted JSON string
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

            // Encrypt all fields containing 'key' or 'secret'
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
 * Decrypt API Key object (batch)
 *
 * @param encryptedJson Encrypted JSON string
 * @returns Decrypted object
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

                // Decrypt all fields containing 'key' or 'secret'
                for (const [key, value] of Object.entries(config)) {
                    if (typeof value === 'string' && value.trim() !== '') {
                        const lowerKey = key.toLowerCase()
                        if (lowerKey.includes('key') || lowerKey.includes('secret')) {
                            try {
                                decryptedConfig[key] = decryptApiKey(value)
                            } catch (error) {
                                _ulogError(`Decrypt ${provider}.${key} failed:`, error)
                                // On decrypt failure keep original (may be plaintext)
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
        _ulogError('Decrypt API Key object failed:', error)
        return {}
    }
}
