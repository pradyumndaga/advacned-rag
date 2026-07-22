import OpenAI from "openai";

let client: OpenAI | null = null;

function getClient(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new Error("OPENAI_API_KEY is not set");
    }
    if (!client) {
        client = new OpenAI({ apiKey });
    }
    return client;
}

export async function openAIChat(model: string, query: string, systemPrompt: string | null = null): Promise<string> {
    const completion = await getClient().chat.completions.create({
        model,
        messages: [
            ...(systemPrompt ? [{ role: "system" as const, content: systemPrompt }] : []),
            { role: "user" as const, content: query },
        ],
    });
    return completion.choices[0].message?.content ?? "";
}

export async function openAIEmbed(input: string, model = "text-embedding-3-small"): Promise<number[]> {
    const response = await getClient().embeddings.create({ model, input });
    return response.data[0].embedding;
}
