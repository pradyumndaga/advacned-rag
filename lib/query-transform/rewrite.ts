import { openAIChat } from "../llm/providers/openai";
import type { TransformedQuery } from "../types";

const SYSTEM_PROMPT = `
Rewrite the query to be more clear and concise.
Clarify any ambiguity.
Expand acronyms if needed.
Normalize phrasing.
Return only the rewritten query.
`
export async function rewriteQuery(query: string): Promise<TransformedQuery> {
    const raw = await openAIChat("gpt-4o-mini", query, SYSTEM_PROMPT);
    const text = raw.trim();
    return { type: "rewrite", text: text || query };
}