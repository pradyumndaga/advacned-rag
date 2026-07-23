const MAX_CHARS = 1200
const OVERLAP = 150

export interface TextChunk {
  text: string
}

// Character-budget chunking for plain-text sources (PDF/Markdown/web page) —
// no inherent timestamp concept for these, so a fixed-size sliding window
// with overlap is enough (see specs.md §2.2).
export function chunkText(text: string): TextChunk[] {
  const clean = text.replace(/\s+/g, " ").trim()
  if (!clean) return []
  if (clean.length <= MAX_CHARS) return [{ text: clean }]

  const chunks: TextChunk[] = []
  let start = 0
  while (start < clean.length) {
    const end = Math.min(start + MAX_CHARS, clean.length)
    chunks.push({ text: clean.slice(start, end).trim() })
    if (end === clean.length) break
    start = end - OVERLAP
  }
  return chunks
}
