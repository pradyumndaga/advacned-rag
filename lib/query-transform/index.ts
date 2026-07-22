import { TransformedQuery } from "../types";
import { rewriteQuery } from "./rewrite";
import { stepbackQuery } from "./stepback";
import { subquestionsQuery } from "./subquestions";
import { hydeQuery } from "./hyde";

const STAGE_NAMES = ["rewrite", "stepback", "subquestions", "hyde"] as const;

export async function transformQuery(query: string): Promise<TransformedQuery[]> {
    const settled = await Promise.allSettled([
        rewriteQuery(query),
        stepbackQuery(query),
        subquestionsQuery(query),
        hydeQuery(query),
    ])

    const results: TransformedQuery[] = [];
    settled.forEach((outcome, i) => {
        if (outcome.status === "fulfilled") {
            results.push(...[outcome.value].flat());
        } else {
            console.error(`query-transform stage "${STAGE_NAMES[i]}" failed:`, outcome.reason);
        }
    });

    return results;
}
