interface GoogleTextPart {
    text?: unknown
    thought?: unknown
    type?: unknown
}

interface GoogleUsageLike {
    promptTokenCount?: unknown
    prompt_tokens?: unknown
    input_tokens?: unknown
    totalTokenCount?: unknown
    total_tokens?: unknown
    candidatesTokenCount?: unknown
    completion_tokens?: unknown
    output_tokens?: unknown
}

interface GoogleResponseLike {
    candidates?: Array<{ content?: { parts?: GoogleTextPart[] }; finishReason?: unknown }>
    response?: { candidates?: Array<{ content?: { parts?: GoogleTextPart[] }; finishReason?: unknown }> }
    usageMetadata?: GoogleUsageLike
    usage?: GoogleUsageLike
}

function toNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isThoughtPart(part: GoogleTextPart): boolean {
    if (part.thought === true) return true
    if (typeof part.type === 'string') {
        const normalized = part.type.toLowerCase()
        if (normalized.includes('thought') || normalized.includes('reason')) return true
    }
    return false
}

/**
 * Google Gemini API returns empty response (not content-safety rejection).
 * Usually model timeout or edge input; retry is appropriate.
 */
export class GoogleEmptyResponseError extends Error {
    constructor(finishReason?: unknown) {
        const reason = finishReason ? ` (finishReason: ${String(finishReason)})` : ''
        super(`Google Gemini returned empty text response${reason}. Please retry.`)
        this.name = 'GoogleEmptyResponseError'
    }
}

export function extractGoogleParts(response: unknown, throwOnEmpty = false): { text: string; reasoning: string } {
    if (!response || typeof response !== 'object') {
        return { text: '', reasoning: '' }
    }
    const safe = response as GoogleResponseLike
    const candidates = safe.candidates || safe.response?.candidates || []
    const firstCandidate = candidates?.[0]
    const parts = firstCandidate?.content?.parts || []
    let text = ''
    let reasoning = ''
    for (const part of parts) {
        const value = typeof part.text === 'string' ? part.text : ''
        if (!value) continue
        if (isThoughtPart(part)) {
            reasoning += value
        } else {
            text += value
        }
    }

    // If candidates exist but text is empty, model returned empty response
    // Only check when throwOnEmpty=true (final non-stream response), avoid false throw between stream chunks
    if (throwOnEmpty && candidates.length > 0 && !text) {
        const finishReason = firstCandidate?.finishReason
        // SAFETY means content-safety rejection, do not retry; otherwise throw retryable error
        if (finishReason !== 'SAFETY' && finishReason !== 'PROHIBITED_CONTENT') {
            throw new GoogleEmptyResponseError(finishReason)
        }
    }

    return {
        text,
        reasoning,
    }
}

export function extractGoogleText(response: unknown): string {
    return extractGoogleParts(response).text
}

export function extractGoogleReasoning(response: unknown): string {
    return extractGoogleParts(response).reasoning
}

export function extractGoogleUsage(response: unknown): { promptTokens: number; completionTokens: number } {
    const safe = response && typeof response === 'object' ? (response as GoogleResponseLike) : null
    const usage = safe?.usageMetadata || safe?.usage
    const promptTokens =
        toNumber(usage?.promptTokenCount) ??
        toNumber(usage?.prompt_tokens) ??
        toNumber(usage?.input_tokens) ??
        0
    const totalTokens = toNumber(usage?.totalTokenCount) ?? toNumber(usage?.total_tokens)
    const completionTokens =
        toNumber(usage?.candidatesTokenCount) ??
        toNumber(usage?.completion_tokens) ??
        toNumber(usage?.output_tokens) ??
        (typeof totalTokens === 'number' ? Math.max(totalTokens - promptTokens, 0) : 0)
    return { promptTokens, completionTokens }
}
