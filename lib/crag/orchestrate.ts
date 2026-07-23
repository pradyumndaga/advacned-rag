import { RetrievedDoc, TransformedQuery } from "@/lib/types"
import { retrieveForQueries } from "@/lib/retrieval/retrieve"
import { rankDocs } from "@/lib/retrieval/ranker"
import { generateAnswer } from "@/lib/generation/generate"
import { evaluateResponse, CragEvaluation } from "./evaluate"
import { extractKeywords } from "./keywords"
import { CragJournalEntry } from "./journal"

const MAX_ATTEMPTS = 3
const PASS_THRESHOLD = 0.6

export interface CragResult {
  content: string
  rankedDocs: RetrievedDoc[]
  retrievedCount: number
  evaluation: CragEvaluation
  attempts: number
  lowConfidence: boolean
  journal: CragJournalEntry[]
}

// Runs retrieval -> ranking -> generation -> eval, retrying with
// keyword-feedback re-seeded retrieval on a failing score, capped at
// MAX_ATTEMPTS total attempts (specs.md §4.8). Re-entry point on retry is
// the route adaptor (via a fresh retrieveForQueries call), not query
// understanding — the original transformed queries already had their shot.
export async function runCragLoop(
  originalQuery: string,
  initialQueries: TransformedQuery[]
): Promise<CragResult> {
  const journal: CragJournalEntry[] = []
  let queriesForRetrieval = initialQueries
  let best: {
    content: string
    rankedDocs: RetrievedDoc[]
    retrievedCount: number
    evaluation: CragEvaluation
  } | null = null
  let attemptsUsed = 0

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    attemptsUsed = attempt
    const retrievedDocs = await retrieveForQueries(queriesForRetrieval)
    const rankedDocs = await rankDocs(originalQuery, retrievedDocs)
    const content = await generateAnswer(originalQuery, rankedDocs)
    const evaluation = await evaluateResponse(originalQuery, rankedDocs, content)

    if (!best || evaluation.score > best.evaluation.score) {
      best = { content, rankedDocs, retrievedCount: retrievedDocs.length, evaluation }
    }

    if (evaluation.score >= PASS_THRESHOLD) {
      break
    }

    const isLastAttempt = attempt === MAX_ATTEMPTS
    const keywords = isLastAttempt ? [] : await extractKeywords(originalQuery, content, evaluation.rationale)

    journal.push({
      attempt,
      score: evaluation.score,
      whatWentWrong: evaluation.rationale,
      fixApplied: isLastAttempt
        ? "exhausted attempts — returning best-scoring response with a low-confidence flag"
        : `re-ran retrieval with keyword feedback: ${keywords.join(", ")}`,
      keywordsUsed: keywords,
    })

    if (isLastAttempt) break

    queriesForRetrieval = [{ type: "keyword-feedback", text: keywords.join(" ") }]
  }

  // best is always set — the loop runs at least once.
  const finalBest = best!
  return {
    content: finalBest.content,
    rankedDocs: finalBest.rankedDocs,
    retrievedCount: finalBest.retrievedCount,
    evaluation: finalBest.evaluation,
    attempts: attemptsUsed,
    lowConfidence: finalBest.evaluation.score < PASS_THRESHOLD,
    journal,
  }
}
