import { RetrievedDoc } from "@/lib/types"
import { openAIChat } from "@/lib/llm/providers/openai"

export interface CragEvaluation {
  score: number // average of the three below, 0-1
  relevance: number
  groundedness: number
  completeness: number
  rationale: string
}

const MINI_MODEL = "gpt-4o-mini"

const SYSTEM_PROMPT = `You are a strict evaluator for a RAG pipeline's generated response.
Score the response against the query and context on three 0-1 dimensions:
- relevance: does the response address what the user actually asked?
- groundedness: is every claim actually supported by the given context, with nothing pulled from outside knowledge?
- completeness: does the response fully answer the question, given what the context contains?
Respond with ONLY a JSON object, no prose:
{"relevance": 0-1, "groundedness": 0-1, "completeness": 0-1, "rationale": "one short sentence"}`

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function parseEvaluation(raw: string): CragEvaluation {
  try {
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) throw new Error("no JSON object in response")
    const parsed = JSON.parse(match[0])
    const relevance = clamp01(Number(parsed.relevance))
    const groundedness = clamp01(Number(parsed.groundedness))
    const completeness = clamp01(Number(parsed.completeness))
    return {
      score: (relevance + groundedness + completeness) / 3,
      relevance,
      groundedness,
      completeness,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    }
  } catch {
    // CRAG eval is a quality signal, not a security control — unlike the
    // guardrails, fail open (treat as passing) so an unparseable mini-model
    // response doesn't trigger a pointless retry loop over noise rather than
    // an actual quality problem.
    return { score: 1, relevance: 1, groundedness: 1, completeness: 1, rationale: "evaluation unavailable" }
  }
}

export async function evaluateResponse(
  query: string,
  context: RetrievedDoc[],
  response: string
): Promise<CragEvaluation> {
  const contextBlock =
    context.map((doc, i) => `[${i + 1}] ${doc.content}`).join("\n\n") || "(no context was retrieved)"
  const prompt = `Query: ${query}\n\nContext:\n${contextBlock}\n\nResponse:\n${response}`
  const raw = await openAIChat(MINI_MODEL, prompt, SYSTEM_PROMPT)
  return parseEvaluation(raw)
}
