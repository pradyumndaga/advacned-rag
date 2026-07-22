import { openAIChat } from "../llm/providers/openai";
import type { TransformedQuery } from "../types";

const SYSTEM_PROMPT = `
Answer the query at a higher level of abstraction.
Use simpler concepts.
Remove jargon and domain-specific terms.
Generalize the intent.
Example: "What was the Q3 revenue?" → "What financial metrics does this company report?"
Return only the rewritten query.
`
export async function stepbackQuery(query: string): Promise<TransformedQuery> {
    const raw = await openAIChat("gpt-4o-mini", query, SYSTEM_PROMPT);
    const text = raw.trim();
    return { type: "stepback", text: text || query };
}