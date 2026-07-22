export interface TransformedQuery {
    type: "stepback" | "rewrite" | "subquestion" | "hyde";
    text: string;
    embedding?: number[];
}