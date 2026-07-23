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