import { openAIChat, openAIEmbed } from "../llm/providers/openai";
import type { TransformedQuery } from "../types";

const SYSTEM_PROMPT = `
Write a short passage that directly answers the query, as if it were an excerpt
from a real document in the knowledge base.
State the answer directly and confidently. Do not hedge, do not say you are
unsure, and do not mention that this is hypothetical.
Keep it to 2-4 sentences.
Return only the passage.
`;

export async function hydeQuery(query: string): Promise<TransformedQuery> {
    const raw = await openAIChat("gpt-4o-mini", query, SYSTEM_PROMPT);
    const text = raw.trim() || query;
    const embedding = await openAIEmbed(text);
    return { type: "hyde", text, embedding };
}
