import { openAIChat } from "@/lib/llm/providers/openai"

const MINI_MODEL = "gpt-4o-mini"
const MAX_KEYWORDS = 5

const SYSTEM_PROMPT = `Extract up to ${MAX_KEYWORDS} short keywords or key phrases that would help a search retrieve better source material for this question, given why the previous attempt fell short.
Respond with ONLY a JSON array of strings, e.g. ["keyword one", "keyword two"]. No prose.`

function parseKeywords(raw: string, fallbackQuery: string): string[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) throw new Error("no array in response")
    const parsed = JSON.parse(match[0])
    if (!Array.isArray(parsed)) throw new Error("not an array")
    const keywords = parsed.filter((k): k is string => typeof k === "string" && k.trim().length > 0)
    if (!keywords.length) throw new Error("empty array")
    return keywords.slice(0, MAX_KEYWORDS)
  } catch {
    // Fail open: retry with the original query itself rather than losing the
    // retry round entirely over a parse error.
    return [fallbackQuery]
  }
}

export async function extractKeywords(query: string, response: string, whatWentWrong: string): Promise<string[]> {
  const prompt = `Original question: ${query}\n\nResponse that scored poorly: ${response}\n\nWhy it scored poorly: ${whatWentWrong}`
  const raw = await openAIChat(MINI_MODEL, prompt, SYSTEM_PROMPT)
  return parseKeywords(raw, query)
}
