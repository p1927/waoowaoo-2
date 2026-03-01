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

// Detection pattern definitions
interface DetectionPattern {
    regex: RegExp
    typeKey: string
    typeName: string
    extractNumber: (match: RegExpMatchArray) => number
    extractTitle: (match: RegExpMatchArray, content: string, nextIndex?: number) => string
}

const DETECTION_PATTERNS: DetectionPattern[] = [
    // 1. Scene number X-Y [scene] - use first number as episode
    {
        regex: /^(\d+)-\d+[\[\[](.*?)[\]\]]/gm,
        typeKey: 'scene',
        typeName: 'X-Y [Scene]',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: (match) => match[2]?.trim() || ''
    },
    // 5. Numeric prefix "1. title" or "1、title"
    {
        regex: /^(\d+)[\.、：:]\s*(.+)/gm,
        typeKey: 'numbered',
        typeName: 'Numeric prefix',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: (match) => match[2]?.trim().slice(0, 20) || ''
    },
    // 5.5 Number + escaped dot "1\." or "3\." (Markdown)
    {
        regex: /^(\d+)\\\.\s*(.+)/gm,
        typeKey: 'numberedEscaped',
        typeName: 'Numeric prefix (escaped)',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: (match) => match[2]?.trim().slice(0, 20) || ''
    },
    // 5.6 Digit followed by letter (no separator) at line or paragraph start
    {
        regex: /(?:^|\n\n)(\d+)([a-zA-Z])/gm,
        typeKey: 'numberedDirect',
        typeName: 'Number + text',
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
        typeName: '**number**',
        extractNumber: (match) => parseInt(match[1], 10),
        extractTitle: () => ''
    },
    // 9. Plain number on its own line (e.g. "1\ncontent")
    {
        regex: /^(\d+)\s*$/gm,
        typeKey: 'pureNumber',
        typeName: 'Plain number',
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
                    title: `Episode ${i}`,
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

        const title = `Episode ${match.episodeNumber}`

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
            title: split.title || `Episode ${split.number}`,
            summary: '', // marker-based split does not generate summary
            content: episodeContent,
            wordCount: countWords(episodeContent)
        }
    })
}
