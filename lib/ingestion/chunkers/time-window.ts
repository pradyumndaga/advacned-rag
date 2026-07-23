import { Cue } from "../types"

const WINDOW_SECONDS = 45

export interface TimedChunk {
  text: string
  startTime: number
  endTime: number
}

// Merge consecutive cues into ~30-60s windows, preserving real start/end
// timestamps as chunk metadata — this is what lets retrieval cite "around
// 2:15" for a transcript source later (see specs.md §2.2).
export function chunkTimedCues(cues: Cue[]): TimedChunk[] {
  if (!cues.length) return []

  const chunks: TimedChunk[] = []
  let windowStart = cues[0].start
  let windowEnd = cues[0].end
  let windowTexts: string[] = []

  for (const cue of cues) {
    if (windowTexts.length && cue.start - windowStart >= WINDOW_SECONDS) {
      chunks.push({ text: windowTexts.join(" "), startTime: windowStart, endTime: windowEnd })
      windowStart = cue.start
      windowTexts = []
    }
    windowTexts.push(cue.text)
    windowEnd = cue.end
  }

  if (windowTexts.length) {
    chunks.push({ text: windowTexts.join(" "), startTime: windowStart, endTime: windowEnd })
  }

  return chunks
}
