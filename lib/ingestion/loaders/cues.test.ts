import { describe, expect, it } from "vitest"
import { parseCues } from "./cues"

describe("parseCues", () => {
  it("parses standard SRT cues", () => {
    const srt = `1
00:00:00,000 --> 00:00:04,000
Welcome to the lecture.

2
00:00:04,500 --> 00:00:09,000
We will cover chunking strategies.`

    const cues = parseCues(srt)
    expect(cues).toHaveLength(2)
    expect(cues[0]).toEqual({ start: 0, end: 4, text: "Welcome to the lecture." })
    expect(cues[1]).toEqual({ start: 4.5, end: 9, text: "We will cover chunking strategies." })
  })

  it("parses VTT cues (WEBVTT header, dot decimals, no cue index)", () => {
    const vtt = `WEBVTT

00:00:00.000 --> 00:00:03.000
Hello from VTT.

00:00:03.500 --> 00:00:06.000
Second cue.`

    const cues = parseCues(vtt)
    expect(cues).toHaveLength(2)
    expect(cues[0]).toEqual({ start: 0, end: 3, text: "Hello from VTT." })
    expect(cues[1].start).toBe(3.5)
  })

  it("joins multi-line cue text into one string", () => {
    const srt = `1
00:00:00,000 --> 00:00:05,000
Line one
Line two`

    const cues = parseCues(srt)
    expect(cues[0].text).toBe("Line one Line two")
  })

  it("strips inline tags like <i> or <b>", () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
<i>Italic text</i> and normal text`

    const cues = parseCues(srt)
    expect(cues[0].text).toBe("Italic text and normal text")
  })

  it("skips cue blocks with no timing line (NOTE/stray text)", () => {
    const vtt = `WEBVTT

NOTE this is a comment block

00:00:00.000 --> 00:00:02.000
Real cue.`

    const cues = parseCues(vtt)
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toBe("Real cue.")
  })

  it("skips a cue with a malformed timestamp (fail-open)", () => {
    const srt = `1
00:00:00,000 --> not-a-timestamp
Broken cue

2
00:00:05,000 --> 00:00:08,000
Good cue`

    const cues = parseCues(srt)
    expect(cues).toHaveLength(1)
    expect(cues[0].text).toBe("Good cue")
  })

  it("skips a cue whose text is empty after tag stripping", () => {
    const srt = `1
00:00:00,000 --> 00:00:02,000
<i></i>`

    const cues = parseCues(srt)
    expect(cues).toHaveLength(0)
  })

  it("returns an empty array for empty input", () => {
    expect(parseCues("")).toEqual([])
  })
})
