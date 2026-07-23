import { RetrievedDoc } from "@/lib/types"
import { openAIEmbed } from "@/lib/llm/providers/openai"

const TOP_K = 8
const TOKEN_BUDGET_CHARS = 6000 // rough char-based proxy, same style as the ingestion chunker's budget

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// Retrieval runs once per transformed query (rewrite, stepback, subquestions,
// hyde), so the same chunk very often comes back more than once — de-dup by
// id, keeping whichever occurrence scored highest. Only exact-id duplicates
// are collapsed; fuzzy near-duplicate detection across *different* chunks is
// deferred until there's evidence it's actually needed (today there's only
// one adapter, so nothing produces near-duplicates from separate sources).
function dedupeById(docs: RetrievedDoc[]): RetrievedDoc[] {
  const seen = new Map<string, RetrievedDoc>()
  for (const doc of docs) {
    const existing = seen.get(doc.id)
    if (!existing || doc.sourceScore > existing.sourceScore) {
      seen.set(doc.id, doc)
    }
  }
  return Array.from(seen.values())
}

// specs.md §4.5 also calls for normalizing per-source scores onto a common
// scale before re-ranking. With only the vector adapter implemented, every
// candidate already comes from the same source using the same metric
// (cosine similarity), so there's nothing to normalize yet — this becomes
// real once a second adapter with a different scoring scale exists.
export async function rankDocs(originalQuery: string, docs: RetrievedDoc[]): Promise<RetrievedDoc[]> {
  const deduped = dedupeById(docs)
  if (!deduped.length) return []

  const queryEmbedding = await openAIEmbed(originalQuery)

  // Re-rank against the *original* query, not whichever transformed query a
  // doc happened to be retrieved by — a doc's retrieval score reflects
  // relevance to a stepback/rewrite/subquestion/HyDE variant, which can
  // diverge from what the user actually asked.
  const rescored = deduped.map((doc) => {
    const vector = doc.metadata.vector as number[] | undefined
    const relevance = vector ? cosineSimilarity(queryEmbedding, vector) : doc.sourceScore
    const metadata = { ...doc.metadata }
    delete metadata.vector
    return { ...doc, sourceScore: relevance, metadata }
  })

  rescored.sort((a, b) => b.sourceScore - a.sourceScore)

  const ranked: RetrievedDoc[] = []
  let budget = 0
  for (const doc of rescored) {
    if (ranked.length >= TOP_K) break
    if (ranked.length > 0 && budget + doc.content.length > TOKEN_BUDGET_CHARS) break
    ranked.push(doc)
    budget += doc.content.length
  }
  return ranked
}
