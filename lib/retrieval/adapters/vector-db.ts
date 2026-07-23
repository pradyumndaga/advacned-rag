import { RetrievedDoc, TransformedQuery } from "@/lib/types"
import { RetrievalAdapter, RetrieveOptions } from "./types"
import { openAIEmbed } from "@/lib/llm/providers/openai"
import { searchChunks } from "@/lib/db/qdrant"

const DEFAULT_TOP_K = 5

export const vectorDbAdapter: RetrievalAdapter = {
  name: "vector",
  async retrieve(query: TransformedQuery, opts: RetrieveOptions = {}): Promise<RetrievedDoc[]> {
    // HyDE already produces an embedding of its hypothetical passage — reuse
    // it instead of re-embedding, since that embedding *is* the query vector
    // HyDE is designed to search with.
    const vector = query.embedding ?? (await openAIEmbed(query.text))
    const matches = await searchChunks(vector, opts.topK ?? DEFAULT_TOP_K)

    return matches.map((match) => ({
      id: match.id,
      content: match.payload.text,
      source: "vector",
      sourceScore: match.score,
      metadata: {
        sourceId: match.payload.sourceId,
        sourceType: match.payload.sourceType,
        chunkIndex: match.payload.chunkIndex,
        startTime: match.payload.startTime,
        endTime: match.payload.endTime,
        // Carried through only for ranker.ts's re-rank-against-original-query
        // step — never serialized back to the client (the chat API route
        // only returns summary counts, not full docs).
        vector: match.vector,
      },
    }))
  },
}
