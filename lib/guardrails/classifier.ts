export interface ClassifierResponse {
    verdict: "accepted" | "rejected";
    reason: string;
}

// Shared by both input and output guardrails — the model sometimes omits
// `reason` when the verdict is "accepted" (nothing noteworthy to explain);
// only the verdict itself is load-bearing.
export function parseClassifierResponse(raw: string): ClassifierResponse | null {
    try {
        const parsed = JSON.parse(raw.trim());
        if (parsed && (parsed.verdict === "accepted" || parsed.verdict === "rejected")) {
            return {
                verdict: parsed.verdict,
                reason: typeof parsed.reason === "string" ? parsed.reason : "",
            };
        }
        return null;
    } catch {
        return null;
    }
}
