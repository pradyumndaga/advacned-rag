import { RetrievedDoc } from "@/lib/types"
import { openAIChat } from "@/lib/llm/providers/openai"

const MAIN_MODEL = "gpt-4o"

const SYSTEM_PROMPT = `You answer the user's question using ONLY the numbered context passages provided below.
- Each passage is numbered like [1], [2], etc.
- Cite the passages you used inline, right after the claim they support, in the form [1].
- If the passages don't contain enough information to answer, say so directly instead of guessing or relying on outside knowledge.
- Do not invent citation numbers that weren't provided.`

const NO_CONTEXT_SYSTEM_PROMPT = `No matching context was found in the indexed documents for this query. Say so plainly, then only answer from general knowledge if it's clearly safe and not something the user expected to come from their documents.`

function buildContextBlock(docs: RetrievedDoc[]): string {
  return docs.map((doc, i) => `[${i + 1}] ${doc.content}`).join("\n\n")
}

// Main-tier LLM call (specs.md §4.6) — original query + top-K ranked
// context. Citation extraction isn't done here: generate.ts just needs the
// ranked docs numbered consistently with the prompt; the caller
// (app/api/chat/route.ts) builds the citation lookup table since it's the
// one that also knows each doc's resource label.
export async function generateAnswer(query: string, rankedDocs: RetrievedDoc[]): Promise<string> {
  if (!rankedDocs.length) {
    return openAIChat(MAIN_MODEL, query, NO_CONTEXT_SYSTEM_PROMPT)
  }

  const prompt = `Context passages:\n\n${buildContextBlock(rankedDocs)}\n\nQuestion: ${query}`
  return openAIChat(MAIN_MODEL, prompt, SYSTEM_PROMPT)
}
