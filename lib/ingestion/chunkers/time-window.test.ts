import { describe, expect, it } from "vitest"
import { chunkTimedCues } from "./time-window"

describe("chunkTimedCues", () => {
  it("returns an empty array for no cues", () => {
    expect(chunkTimedCues([])).toEqual([])
  })

  it("merges consecutive cues within the same ~45s window", () => {
    const cues = [
      { start: 0, end: 4, text: "one" },
      { start: 4.5, end: 9, text: "two" },
      { start: 9.5, end: 14, text: "three" },
    ]
    const chunks = chunkTimedCues(cues)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ text: "one two three", startTime: 0, endTime: 14 })
  })

  it("starts a new window once a cue is >= 45s after the window start", () => {
    const cues = [
      { start: 0, end: 4, text: "first window" },
      { start: 50, end: 54, text: "second window" },
    ]
    const chunks = chunkTimedCues(cues)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual({ text: "first window", startTime: 0, endTime: 4 })
    expect(chunks[1]).toEqual({ text: "second window", startTime: 50, endTime: 54 })
  })

  it("preserves real start/end timestamps rather than chunking by character count", () => {
    const cues = [
      { start: 120.5, end: 122, text: "timestamped content" },
    ]
    const chunks = chunkTimedCues(cues)
    expect(chunks[0].startTime).toBe(120.5)
    expect(chunks[0].endTime).toBe(122)
  })

  it("flushes a trailing partial window", () => {
    const cues = [
      { start: 0, end: 2, text: "a" },
      { start: 100, end: 102, text: "b" },
      { start: 101, end: 103, text: "c" },
    ]
    const chunks = chunkTimedCues(cues)
    expect(chunks).toHaveLength(2)
    expect(chunks[1].text).toBe("b c")
  })
})
