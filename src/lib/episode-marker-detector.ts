/**
 * Episode marker detector.
 * Detects explicit episode markers in text and supports pre-splitting.
 */

import { countWords } from './word-count'

export interface EpisodeMarkerMatch {
    index: number          // position in source text
    text: string           // matched marker text
    episodeNumber: number  // inferred episode number
}

export interface PreviewSplit {
    number: number
    title: string
    wordCount: number
    startIndex: number
    endIndex: number
    preview: string        // first 20 chars preview
}

export interface EpisodeMarkerResult {
    hasMarkers: boolean
    markerType: string
    markerTypeKey: string  // i18n key
    confidence: 'high' | 'medium' | 'low'
    matches: EpisodeMarkerMatch[]
    previewSplits: PreviewSplit[]
}

// Chinese numeral mapping (keys kept for parsing input)
const CHINESE_NUMBERS: Record<string, number> = {
    '零': 0, '〇': 0,
    '一': 1, '壹': 1,
    '二': 2, '贰': 2, '两': 2,
    '三': 3, '叁': 3,
    '四': 4, '肆': 4,
    '五': 5, '伍': 5,
    '六': 6, '陆': 6,
    '七': 7, '柒': 7,
    '八': 8, '捌': 8,
    '九': 9, '玖': 9,
    '十': 10, '拾': 10,
    '百': 100, '佰': 100,
    '千': 1000, '仟': 1000,
}

/**
 * Converts Chinese numerals to Arabic numbers.
 */
function chineseToNumber(chinese: string): number {
    // if already digits, return as-is
    if (/^\d+$/.test(chinese)) {
        return parseInt(chinese, 10)
    }

    let result = 0
    let temp = 0
    let lastUnit = 1

    for (const char of chinese) {
        const num = CHINESE_NUMBERS[char]
        if (num === undefined) continue

        if (num >= 10) {
            // unit (ten, hundred, thousand)
            if (temp === 0) temp = 1
            temp *= num
            if (num >= lastUnit) {
                result += temp
                temp = 0
            }
            lastUnit = num
        } else {
            // digit
            temp = num
        }
    }

    return result + temp
}

// Detection pattern definitions
interface DetectionPattern {
    regex: RegExp
    typeKey: string
    typeName: string
    extractNumber: (match: RegExpMatchArray) => number
    extractTitle: (match: RegExpMatchArray, content: string, nextIndex?: number) => string
}

const DETECTION_PATTERNS: DetectionPattern[] = [
    // 1. Chinese "Episode X"
    {
        regex: /^第([一二三四五六七八九十百千\d]+)集[：:\s]*(.*)?/gm,
        typeKey: 'episode',
        typeName: '第X集',
        extractNumber: (match) => chineseToNumber(match[1]),
        extractTitle: (match) => match[2]?.trim() || ''
    },
    // 2. Chinese "Chapter X"
    {
        regex: /^第([一二三四五六七八九十百千\d]+)章[：:\s]*(.*)?/gm,
        typeKey: 'chapter',
        typeName: '第X章',
        extractNumber: (match) => chineseToNumber(match[1]),
        extractTitle: (match) => match[2]?.trim() || ''
    },
    // 3. Chinese "Act X"
    {
        regex: /^第([一二三四五六七八九十百千\d]+)幕[：:\s]*(.*)?/gm,
        typeKey: 'act',
        typeName: '第X幕',
        extractNumber: (match) => chineseToNumber(match[1]),
        extractTitle: (match) => match[2]?.trim() || ''
    },
    // 4. Scene number X-Y【scene】 - use first number as episode
    {
        regex: /^(\d+)-\d+[【\[](.*?)[】\]]/gm,
        typeKey: 'scene',
        typeName: 'X-Y【场景】',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: (match) => match[2]?.trim() || ''
    },
    // 5. Numeric prefix "1. title" or "1、title"
    {
        regex: /^(\d+)[\.、：:]\s*(.+)/gm,
        typeKey: 'numbered',
        typeName: '数字编号',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: (match) => match[2]?.trim().slice(0, 20) || ''
    },
    // 5.5 Number + escaped dot "1\." or "3\." (Markdown)
    {
        regex: /^(\d+)\\\.\s*(.+)/gm,
        typeKey: 'numberedEscaped',
        typeName: '数字编号(转义)',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: (match) => match[2]?.trim().slice(0, 20) || ''
    },
    // 5.6 Digit followed directly by Chinese (no separator) - digit at line or paragraph start
    {
        regex: /(?:^|\n\n)(\d+)([\u4e00-\u9fa5])/gm,
        typeKey: 'numberedDirect',
        typeName: '数字+中文',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: (match) => match[2]?.trim().slice(0, 20) || ''
    },
    // 6. English Episode
    {
        regex: /^Episode\s*(\d+)[：:\s]*(.*)?/gim,
        typeKey: 'episodeEn',
        typeName: 'Episode X',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: (match) => match[2]?.trim() || ''
    },
    // 7. English Chapter
    {
        regex: /^Chapter\s*(\d+)[：:\s]*(.*)?/gim,
        typeKey: 'chapterEn',
        typeName: 'Chapter X',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: (match) => match[2]?.trim() || ''
    },
    // 8. Markdown bold number (e.g. "...content**1**..." ); may appear inline
    {
        regex: /\*\*(\d+)\*\*/g,
        typeKey: 'boldNumber',
        typeName: '**数字**',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: () => ''
    },
    // 9. Plain number on its own line (e.g. "1\ncontent")
    {
        regex: /^(\d+)\s*$/gm,
        typeKey: 'pureNumber',
        typeName: '纯数字',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: () => ''
    },
]

/**
 * Detects episode markers in text.
 */
export function detectEpisodeMarkers(content: string): EpisodeMarkerResult {
    const result: EpisodeMarkerResult = {
        hasMarkers: false,
        markerType: '',
        markerTypeKey: '',
        confidence: 'low',
        matches: [],
        previewSplits: []
    }

    if (!content || content.length < 100) {
        return result
    }

    // try each pattern
    for (const pattern of DETECTION_PATTERNS) {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags)
        const matches: EpisodeMarkerMatch[] = []
        let match: RegExpExecArray | null

        while ((match = regex.exec(content)) !== null) {
            const episodeNumber = pattern.extractNumber(match)

            // scene pattern: record only first occurrence per episode
            if (pattern.typeKey === 'scene') {
                const existingMatch = matches.find(m => m.episodeNumber === episodeNumber)
                if (existingMatch) {
                    continue // skip later scenes in same episode
                }
            }

            matches.push({
                index: match.index,
                text: match[0],
                episodeNumber
            })
        }

        // use this pattern if it yields more matches
        if (matches.length >= 2 && matches.length > result.matches.length) {
            result.matches = matches
            result.markerType = pattern.typeName
            result.markerTypeKey = pattern.typeKey
            result.hasMarkers = true
        }
    }

    if (!result.hasMarkers) {
        return result
    }

    // sort by position
    result.matches.sort((a, b) => a.index - b.index)

    // compute confidence
    const matchCount = result.matches.length
    const avgDistance = result.matches.length > 1
        ? (result.matches[result.matches.length - 1].index - result.matches[0].index) / (result.matches.length - 1)
        : 0

    if (matchCount >= 3 && avgDistance >= 500 && avgDistance <= 8000) {
        result.confidence = 'high'
    } else if (matchCount >= 2) {
        result.confidence = 'medium'
    } else {
        result.confidence = 'low'
    }

    // build preview splits
    const previewSplits: PreviewSplit[] = []

    // if first marker is not episode 1 and there is content before it, backfill missing episodes
    const firstMatch = result.matches[0]
    if (firstMatch && firstMatch.episodeNumber > 1 && firstMatch.index > 100) {
        for (let i = 1; i < firstMatch.episodeNumber; i++) {
            if (i === 1) {
                const episodeContent = content.slice(0, firstMatch.index)
                const preview = episodeContent.slice(0, 50).trim().slice(0, 20)
                previewSplits.push({
                    number: i,
                    title: `第 ${i} 集`,
                    wordCount: countWords(episodeContent),
                    startIndex: 0,
                    endIndex: firstMatch.index,
                    preview: preview + (preview.length >= 20 ? '...' : '')
                })
                break // only backfill episode 1
            }
        }
    }

    // process detected markers
    result.matches.forEach((match, idx) => {
        const startIndex = idx === 0 && previewSplits.length === 0 ? 0 : match.index
        const endIndex = idx < result.matches.length - 1
            ? result.matches[idx + 1].index
            : content.length

        const episodeContent = content.slice(startIndex, endIndex)
        const wordCount = countWords(episodeContent)

        const title = `第 ${match.episodeNumber} 集`

        // preview: content after numeric prefix (skip "1." etc., not whole line)
        const markerPositionInContent = match.index - startIndex
        // length of numeric prefix
        const markerPrefix = match.text.match(/^(?:第[一二三四五六七八九十百千\d]+[集章幕]|Episode\s*\d+|Chapter\s*\d+|\*\*\d+\*\*|\d+)[\.、：:\s]*/i)?.[0] || ''
        const prefixLength = markerPrefix.length || match.text.length
        const previewStart = markerPositionInContent + prefixLength
        const preview = episodeContent.slice(previewStart, previewStart + 50).trim().slice(0, 20)

        previewSplits.push({
            number: match.episodeNumber,
            title,
            wordCount,
            startIndex,
            endIndex,
            preview: preview + (preview.length >= 20 ? '...' : '')
        })
    })

    result.previewSplits = previewSplits

    return result
}

/**
 * Splits content by detection result.
 */
export function splitByMarkers(content: string, markerResult: EpisodeMarkerResult): Array<{
    number: number
    title: string
    summary: string
    content: string
    wordCount: number
}> {
    if (!markerResult.hasMarkers || markerResult.previewSplits.length === 0) {
        return []
    }

    return markerResult.previewSplits.map(split => {
        const episodeContent = content.slice(split.startIndex, split.endIndex).trim()

        return {
            number: split.number,
            title: split.title || `第 ${split.number} 集`,
            summary: '', // marker-based split does not generate summary
            content: episodeContent,
            wordCount: countWords(episodeContent)
        }
    })
}
