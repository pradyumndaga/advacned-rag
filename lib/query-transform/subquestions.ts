import { openAIChat } from "../llm/providers/openai";
import type { TransformedQuery } from "../types";

const SYSTEM_PROMPT = `
You are a subquestion decomposition engine.
Your job is to break down a complex query into 3-5 smaller, atomic, fact-based subquestions.

Rules:
1. Each subquestion must be answerable by a single retrieval pass.
2. Avoid asking multiple questions in one subquestion.
3. Break down compound questions into simple, atomic parts.
4. Keep subquestions focused and self-contained.
5. Do NOT answer the query yourself. Just generate the subquestions.
6. Output ONLY a JSON array of strings.

Example 1:
Query: "What was Google's Q3 2023 revenue and how does it compare to Apple's?"
Output: ["What was Google's Q3 2023 revenue?", "What was Apple's Q3 2023 revenue?", "How does Google's Q3 2023 revenue compare to Apple's?"]

Example 2:
Query: "Tell me about the history of AI and its major milestones."
Output: ["What is the history of AI?", "What are the major milestones in the history of AI?"]

Example 3:
Query: "Compare the Ryzen 9 5950X and Intel Core i9-13900K processors."
Output: ["What is the architecture of the Ryzen 9 5950X?", "What is the architecture of the Intel Core i9-13900K?", "How do their clock speeds compare?", "How do their core counts compare?", "How do their cache sizes compare?"]

Return ONLY the JSON array. No markdown. No explanation. No extra text.`

const MAX_SUBQUESTIONS = 5;

function parseSubquestions(raw: string): string[] | null {
    try {
        const parsed = JSON.parse(raw.trim());
        if (
            Array.isArray(parsed) &&
            parsed.length > 0 &&
            parsed.every((item) => typeof item === "string" && item.trim().length > 0)
        ) {
            return parsed.map((item) => item.trim());
        }
        return null;
    } catch {
        return null;
    }
}

export async function subquestionsQuery(query: string): Promise<TransformedQuery[]> {
    const raw = await openAIChat("gpt-4o-mini", query, SYSTEM_PROMPT);
    const subquestions = parseSubquestions(raw);

    if (!subquestions) {
        return [{ type: "subquestion", text: query }];
    }

    return subquestions
        .slice(0, MAX_SUBQUESTIONS)
        .map((text) => ({ type: "subquestion", text }));
}