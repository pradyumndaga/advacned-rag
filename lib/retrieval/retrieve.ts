import { RetrievedDoc, TransformedQuery } from "@/lib/types"
import { routeQuery } from "./route-adaptor"
import { RetrievalAdapter } from "./adapters/types"
import { vectorDbAdapter } from "./adapters/vector-db"

const ADAPTERS: Partial<Record<string, RetrievalAdapter>> = {
  vector: vectorDbAdapter,
}

// Fanned out in-process via Promise.allSettled, same as query-transform
// (specs.md §5) — the caller (the chat API route) has to synchronously wait
// for these results before ranking/generation can run, so there's no
// "fire and forget" benefit a queue would add here.
export async function retrieveForQueries(queries: TransformedQuery[], userId: string): Promise<RetrievedDoc[]> {
  const jobs: Promise<RetrievedDoc[]>[] = []

  for (const query of queries) {
    for (const target of routeQuery(query)) {
      const adapter = ADAPTERS[target]
      if (!adapter) continue // routed to an adapter that isn't implemented yet
      jobs.push(adapter.retrieve(query, { userId }))
    }
  }

  const settled = await Promise.allSettled(jobs)
  const docs: RetrievedDoc[] = []
  settled.forEach((outcome) => {
    if (outcome.status === "fulfilled") {
      docs.push(...outcome.value)
    } else {
      console.error("retrieval adapter failed:", outcome.reason)
    }
  })
  return docs
}
