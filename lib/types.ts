export interface TransformedQuery {
    type: "stepback" | "rewrite" | "subquestion" | "hyde";
    text: string;
    embedding?: number[];
}

export interface RetrievedDoc {
    id: string;
    content: string;
    source: string;
    sourceScore: number;
    metadata: Record<string, unknown>;
}

// One per ranked doc handed to generation, numbered in the same order the
// LLM was shown them ("[1]", "[2]", ...) — the frontend only turns a "[N]"
// it finds in the answer text into a clickable link, so which citations end
// up visible is driven entirely by which ones the model actually referenced.
export interface Citation {
    index: number;
    sourceId: string;
    chunkIndex: number;
    label: string;
}