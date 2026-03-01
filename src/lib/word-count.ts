/**
 * Word count utility functions
 *
 * Following Microsoft Word's word count rules:
 * - Chinese: 1 count per Chinese character
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

    // 处理英文和数字：将连续的英文字母和数字视为一个"单词"
    // 先用正则替换掉英文+数字组成的单词，同时计数
    let englishWordCount = 0
    const textWithoutEnglish = text.replace(/[a-zA-Z0-9]+/g, () => {
        englishWordCount++
        return '' // 移除英文单词，剩下的就是中文和其他字符
    })

    // Count Chinese characters
    // Use Unicode ranges for common CJK + extended A/B
    const chineseMatches = textWithoutEnglish.match(/[\u4e00-\u9fa5\u3400-\u4dbf\u20000-\u2a6df]/g)
    const chineseCount = chineseMatches ? chineseMatches.length : 0

    return englishWordCount + chineseCount
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
