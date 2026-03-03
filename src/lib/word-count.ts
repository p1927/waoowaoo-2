/**
 * Word count utility functions
 *
 * Following Microsoft Word's word count rules:
 * - Devanagari (Hindi/Sanskrit): space-separated words
 * - English: 1 count per word (space-separated)
 * - Spaces, newlines, and punctuation are not counted
 */

/**
 * Count words in text (simulating Microsoft Word word count)
 *
 * @param text Input text
 * @returns Word count (not character count!)
 */
export function countWords(text: string): number {
    if (!text) return 0

    let englishWordCount = 0
    const textWithoutEnglish = text.replace(/[a-zA-Z0-9]+/g, () => {
        englishWordCount++
        return ''
    })

    // Devanagari (Hindi/Sanskrit): \u0900-\u097F, Extended: \uA8E0-\uA8FF, Vedic: \u1CD0-\u1CFF
    // Count space-separated Devanagari word clusters
    const devanagariMatches = textWithoutEnglish.match(/[\u0900-\u097F\uA8E0-\uA8FF\u1CD0-\u1CFF]+/g)
    const devanagariCount = devanagariMatches ? devanagariMatches.length : 0

    return englishWordCount + devanagariCount
}

/**
 * Count characters in text (including all characters)
 * Equivalent to JavaScript's string.length
 *
 * @param text Input text
 * @returns Character count
 */
export function countCharacters(text: string): number {
    return text?.length || 0
}

/**
 * Count characters in text (excluding spaces)
 *
 * @param text Input text
 * @returns Character count (excluding spaces)
 */
export function countCharactersNoSpaces(text: string): number {
    if (!text) return 0
    return text.replace(/\s/g, '').length
}
