import { describe, expect, it } from "vitest"
import { chunkText } from "./token-budget"

describe("chunkText", () => {
  it("returns a single chunk for short text", () => {
    const chunks = chunkText("A short document about RAG.")
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toBe("A short document about RAG.")
  })

  it("returns an empty array for empty or whitespace-only text", () => {
    expect(chunkText("")).toEqual([])
    expect(chunkText("   \n\n  ")).toEqual([])
  })

  it("collapses internal whitespace/newlines", () => {
    const chunks = chunkText("Line one\n\n   Line two\twith tabs")
    expect(chunks[0].text).toBe("Line one Line two with tabs")
  })

  it("splits long text into multiple overlapping chunks", () => {
    const longText = "word ".repeat(400) // well over the 1200-char budget
    const chunks = chunkText(longText)
    expect(chunks.length).toBeGreaterThan(1)
    // every chunk must respect the character budget
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(1200)
    }
  })

  it("produces overlapping content between consecutive chunks", () => {
    const longText = Array.from({ length: 500 }, (_, i) => `word${i}`).join(" ")
    const chunks = chunkText(longText)
    expect(chunks.length).toBeGreaterThan(1)
    // the tail of chunk N should reappear at the head of chunk N+1 (150-char overlap)
    const tailOfFirst = chunks[0].text.slice(-50)
    expect(chunks[1].text).toContain(tailOfFirst)
  })

  it("terminates and covers the full text without gaps", () => {
    const longText = "x".repeat(3000)
    const chunks = chunkText(longText)
    // last chunk should reach the end of the text
    expect(chunks[chunks.length - 1].text.endsWith("x")).toBe(true)
    expect(chunks.length).toBeGreaterThanOrEqual(3)
  })
})
