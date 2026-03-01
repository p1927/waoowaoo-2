/**
 * SRT subtitle entry
 */
export interface SRTEntry {
  index: number
  startTime: string
  endTime: string
  text: string
}

/**
 * 解析SRT格式文本
 * @param srtText SRT格式文本
 * @returns SRT条目数组
 */
export function parseSRT(srtText: string): SRTEntry[] {
  const entries: SRTEntry[] = []
  
  // 按空行分割
  const blocks = srtText.trim().split(/\n\s*\n/)
  
  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 3) continue
    
    const index = parseInt(lines[0])
    const timeLine = lines[1]
    const text = lines.slice(2).join('\n')
    
    // 解析时间行：00:00:00,000 --> 00:00:02,000
    const timeMatch = timeLine.match(/(\S+)\s*-->\s*(\S+)/)
    if (!timeMatch) continue
    
    entries.push({
      index,
      startTime: timeMatch[1],
      endTime: timeMatch[2],
      text
    })
  }
  
  return entries
}

/**
 * 根据序号范围切割SRT内容
 * @param srtText 完整SRT文本
 * @param start 起始序号（包含）
 * @param end 结束序号（包含）
 * @returns 切割后的SRT文本
 */
export function sliceSRT(srtText: string, start: number, end: number): string {
  const entries = parseSRT(srtText)
  
  // Filter entries in the specified range
  const slicedEntries = entries.filter(entry => entry.index >= start && entry.index <= end)
  
  // Reassemble as SRT format
  return slicedEntries.map(entry => 
    `${entry.index}\n${entry.startTime} --> ${entry.endTime}\n${entry.text}`
  ).join('\n\n')
}

/**
 * Calculate total duration of SRT segment (seconds)
 * @param srtText SRT text
 * @returns Total duration in seconds
 */
export function calculateSRTDuration(srtText: string): number {
  const entries = parseSRT(srtText)
  if (entries.length === 0) return 0
  
  const firstEntry = entries[0]
  const lastEntry = entries[entries.length - 1]
  
  const startSeconds = timeToSeconds(firstEntry.startTime)
  const endSeconds = timeToSeconds(lastEntry.endTime)
  
  return endSeconds - startSeconds
}

/**
 * Convert SRT time format to seconds
 * @param timeStr Time string (e.g. 00:00:02,500)
 * @returns Seconds
 */
function timeToSeconds(timeStr: string): number {
  // Format: HH:MM:SS,mmm
  const match = timeStr.match(/(\d+):(\d+):(\d+)[,.](\d+)/)
  if (!match) return 0
  
  const hours = parseInt(match[1])
  const minutes = parseInt(match[2])
  const seconds = parseInt(match[3])
  const milliseconds = parseInt(match[4])
  
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000
}

/**
 * Validate whether text is valid SRT format
 * @param text Text content
 * @returns Whether valid
 */
export function isValidSRT(text: string): boolean {
  try {
    const entries = parseSRT(text)
    return entries.length > 0
  } catch {
    return false
  }
}

/**
 * Extract plain text from SRT format (remove index and timeline)
 * @param srtText SRT format text
 * @returns Plain text content
 */
export function extractTextFromSRT(srtText: string): string {
  const entries = parseSRT(srtText)
  return entries.map(entry => entry.text).join('\n')
}

