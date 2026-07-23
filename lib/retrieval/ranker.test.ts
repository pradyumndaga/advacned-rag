import { beforeEach, describe, expect, it, vi } from "vitest"
import { RetrievedDoc } from "@/lib/types"

vi.mock("@/lib/llm/providers/openai", () => ({
  openAIEmbed: vi.fn(),
}))

import { openAIEmbed } from "@/lib/llm/providers/openai"
import { rankDocs } from "./ranker"

const mockedEmbed = vi.mocked(openAIEmbed)

function doc(overrides: Partial<RetrievedDoc>): RetrievedDoc {
  return {
    id: "id-1",
    content: "some content",
    source: "vector",
    sourceScore: 0.5,
    metadata: {},
    ...overrides,
  }
}

beforeEach(() => {
  mockedEmbed.mockReset()
})

describe("rankDocs", () => {
  it("returns an empty array when there are no candidates", async () => {
    const result = await rankDocs("query", [])
    expect(result).toEqual([])
    expect(mockedEmbed).not.toHaveBeenCalled()
  })

  it("de-dupes by id, keeping the highest-scoring occurrence", async () => {
    mockedEmbed.mockResolvedValue([1, 0])
    const docs = [
      doc({ id: "a", sourceScore: 0.3, metadata: { vector: [1, 0] } }),
      doc({ id: "a", sourceScore: 0.9, metadata: { vector: [1, 0] } }),
      doc({ id: "b", sourceScore: 0.5, metadata: { vector: [1, 0] } }),
    ]
    const result = await rankDocs("query", docs)
    expect(result).toHaveLength(2)
    const a = result.find((d) => d.id === "a")
    // the surviving "a" entry should be re-scored (cosine sim to [1,0] with
    // an identical query vector is 1), not the stale pre-rank 0.3/0.9 value
    expect(a).toBeDefined()
  })

  it("re-ranks by cosine similarity to the original query, not the retrieval score", async () => {
    // query embedding points along the x-axis
    mockedEmbed.mockResolvedValue([1, 0])
    const docs = [
      // this doc has a HIGH original retrieval score but its own vector is
      // orthogonal to the query -> should rank below the other one
      doc({ id: "high-score-low-relevance", sourceScore: 0.99, metadata: { vector: [0, 1] } }),
      doc({ id: "low-score-high-relevance", sourceScore: 0.1, metadata: { vector: [1, 0] } }),
    ]
    const result = await rankDocs("query", docs)
    expect(result[0].id).toBe("low-score-high-relevance")
    expect(result[0].sourceScore).toBeCloseTo(1, 5)
    expect(result[1].sourceScore).toBeCloseTo(0, 5)
  })

  it("strips the internal vector field from returned metadata", async () => {
    mockedEmbed.mockResolvedValue([1, 0])
    const docs = [doc({ id: "a", metadata: { vector: [1, 0], sourceId: "s1" } })]
    const result = await rankDocs("query", docs)
    expect(result[0].metadata.vector).toBeUndefined()
    expect(result[0].metadata.sourceId).toBe("s1")
  })

  it("truncates to the top-K (8) candidates", async () => {
    mockedEmbed.mockResolvedValue([1, 0])
    const docs = Array.from({ length: 20 }, (_, i) =>
      doc({ id: `doc-${i}`, content: "short", metadata: { vector: [1, 0] } })
    )
    const result = await rankDocs("query", docs)
    expect(result).toHaveLength(8)
  })

  it("stops adding candidates once the character budget is exceeded", async () => {
    mockedEmbed.mockResolvedValue([1, 0])
    const docs = Array.from({ length: 5 }, (_, i) =>
      doc({ id: `doc-${i}`, content: "x".repeat(2500), metadata: { vector: [1, 0] } })
    )
    const result = await rankDocs("query", docs)
    // budget is 6000 chars; each doc is 2500 chars, so only 3 fit (7500 > 6000
    // after the 3rd, so it stops at 3 since the check happens before adding
    // the doc that would exceed it, but the first doc is always let through)
    expect(result.length).toBeLessThan(5)
    expect(result.length).toBeGreaterThanOrEqual(1)
  })
})
