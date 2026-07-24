import { beforeEach, describe, expect, it, vi } from "vitest"
import { RetrievedDoc, TransformedQuery } from "@/lib/types"

vi.mock("@/lib/retrieval/retrieve", () => ({ retrieveForQueries: vi.fn() }))
vi.mock("@/lib/retrieval/ranker", () => ({ rankDocs: vi.fn() }))
vi.mock("@/lib/generation/generate", () => ({ generateAnswer: vi.fn() }))
vi.mock("./evaluate", () => ({ evaluateResponse: vi.fn() }))
vi.mock("./keywords", () => ({ extractKeywords: vi.fn() }))

import { retrieveForQueries } from "@/lib/retrieval/retrieve"
import { rankDocs } from "@/lib/retrieval/ranker"
import { generateAnswer } from "@/lib/generation/generate"
import { evaluateResponse } from "./evaluate"
import { extractKeywords } from "./keywords"
import { runCragLoop } from "./orchestrate"

const mockedRetrieve = vi.mocked(retrieveForQueries)
const mockedRank = vi.mocked(rankDocs)
const mockedGenerate = vi.mocked(generateAnswer)
const mockedEvaluate = vi.mocked(evaluateResponse)
const mockedKeywords = vi.mocked(extractKeywords)

const someDocs: RetrievedDoc[] = [
  { id: "d1", content: "content", source: "vector", sourceScore: 0.9, metadata: {} },
]

const initialQueries: TransformedQuery[] = [{ type: "rewrite", text: "the query" }]

beforeEach(() => {
  mockedRetrieve.mockReset().mockResolvedValue(someDocs)
  mockedRank.mockReset().mockResolvedValue(someDocs)
  mockedGenerate.mockReset().mockResolvedValue("an answer")
  mockedEvaluate.mockReset()
  mockedKeywords.mockReset().mockResolvedValue(["keyword one", "keyword two"])
})

describe("runCragLoop", () => {
  it("stops after a single passing attempt", async () => {
    mockedEvaluate.mockResolvedValue({
      score: 0.9,
      relevance: 0.9,
      groundedness: 0.9,
      completeness: 0.9,
      rationale: "great answer",
    })

    const result = await runCragLoop("original query", initialQueries, "user_test123")

    expect(result.attempts).toBe(1)
    expect(result.lowConfidence).toBe(false)
    expect(result.journal).toEqual([])
    expect(result.content).toBe("an answer")
    expect(mockedRetrieve).toHaveBeenCalledTimes(1)
    expect(mockedKeywords).not.toHaveBeenCalled()
  })

  it("retries with keyword-feedback seeded retrieval after a failing attempt, then succeeds", async () => {
    mockedEvaluate
      .mockResolvedValueOnce({ score: 0.3, relevance: 0.3, groundedness: 0.3, completeness: 0.3, rationale: "missed the point" })
      .mockResolvedValueOnce({ score: 0.8, relevance: 0.8, groundedness: 0.8, completeness: 0.8, rationale: "much better" })

    const result = await runCragLoop("original query", initialQueries, "user_test123")

    expect(result.attempts).toBe(2)
    expect(result.lowConfidence).toBe(false)
    expect(result.journal).toHaveLength(1)
    expect(result.journal[0]).toMatchObject({
      attempt: 1,
      score: 0.3,
      whatWentWrong: "missed the point",
      keywordsUsed: ["keyword one", "keyword two"],
    })
    expect(result.journal[0].fixApplied).toContain("keyword one, keyword two")

    // second retrieval call must be seeded with only the keyword-feedback query
    expect(mockedRetrieve).toHaveBeenCalledTimes(2)
    expect(mockedRetrieve.mock.calls[1][0]).toEqual([
      { type: "keyword-feedback", text: "keyword one keyword two" },
    ])
    // userId must be threaded through to every retrieval call, not just the first
    expect(mockedRetrieve.mock.calls[0][1]).toBe("user_test123")
    expect(mockedRetrieve.mock.calls[1][1]).toBe("user_test123")
  })

  it("caps at 3 attempts, skips keyword extraction on the final attempt, and flags low confidence", async () => {
    mockedEvaluate.mockResolvedValue({
      score: 0.2,
      relevance: 0.2,
      groundedness: 0.2,
      completeness: 0.2,
      rationale: "still not grounded",
    })

    const result = await runCragLoop("original query", initialQueries, "user_test123")

    expect(result.attempts).toBe(3)
    expect(result.lowConfidence).toBe(true)
    expect(result.journal).toHaveLength(3)
    expect(result.journal[2].keywordsUsed).toEqual([])
    expect(result.journal[2].fixApplied).toMatch(/exhausted attempts/)
    // keyword extraction only happens for attempts that still get a retry (1 and 2, not 3)
    expect(mockedKeywords).toHaveBeenCalledTimes(2)
    expect(mockedRetrieve).toHaveBeenCalledTimes(3)
  })

  it("returns the best-scoring attempt even when it wasn't the last one", async () => {
    mockedEvaluate
      .mockResolvedValueOnce({ score: 0.3, relevance: 0.3, groundedness: 0.3, completeness: 0.3, rationale: "attempt 1" })
      .mockResolvedValueOnce({ score: 0.5, relevance: 0.5, groundedness: 0.5, completeness: 0.5, rationale: "attempt 2 (best)" })
      .mockResolvedValueOnce({ score: 0.2, relevance: 0.2, groundedness: 0.2, completeness: 0.2, rationale: "attempt 3" })
    mockedGenerate
      .mockResolvedValueOnce("answer 1")
      .mockResolvedValueOnce("answer 2 (best)")
      .mockResolvedValueOnce("answer 3")

    const result = await runCragLoop("original query", initialQueries, "user_test123")

    expect(result.attempts).toBe(3)
    expect(result.lowConfidence).toBe(true) // 0.5 is still below the 0.6 threshold
    expect(result.content).toBe("answer 2 (best)")
    expect(result.evaluation.rationale).toBe("attempt 2 (best)")
  })
})
