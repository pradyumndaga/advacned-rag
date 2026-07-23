import { Cue } from "../types"

const TIMESTAMP = /(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/

function toSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
}

// Shared core for SRT and VTT: both are cue blocks separated by a blank line,
// with a "start --> end" timing line and one or more text lines after it.
// VTT differs only in an optional `WEBVTT` header and `.` instead of `,` in
// timestamps, which the regex above already tolerates.
export function parseCues(raw: string): Cue[] {
  const normalized = raw
    .replace(/^﻿/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^WEBVTT[^\n]*\n/, "")

  const blocks = normalized
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)

  const cues: Cue[] = []

  for (const block of blocks) {
    const lines = block.split("\n")
    const timingLineIndex = lines.findIndex((line) => line.includes("-->"))
    if (timingLineIndex === -1) continue // NOTE blocks, stray cue numbers, etc.

    const [startRaw, endRaw] = lines[timingLineIndex].split("-->")
    const startMatch = startRaw?.match(TIMESTAMP)
    const endMatch = endRaw?.match(TIMESTAMP)
    if (!startMatch || !endMatch) continue // fail-open: skip malformed cue

    const start = toSeconds(startMatch[1], startMatch[2], startMatch[3], startMatch[4])
    const end = toSeconds(endMatch[1], endMatch[2], endMatch[3], endMatch[4])

    const text = lines
      .slice(timingLineIndex + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim()
    if (!text) continue

    cues.push({ start, end, text })
  }

  return cues
}
