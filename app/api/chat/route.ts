import { NextResponse } from "next/server";
import { openAIChat } from "@/lib/llm/providers/openai";
import { inputGuardRails } from "@/lib/guardrails/input";
import { transformQuery } from "@/lib/query-transform";

export async function POST(request: Request) {
  const { query } = await request.json();

  if (typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const inputGuard = await inputGuardRails(query);
  if (!inputGuard.passed) {
    return NextResponse.json({ refused: true, reason: inputGuard.reason }, { status: 400 });
  }

  const transformedQueries = await transformQuery(query);

  // Retrieval/ranking aren't built yet, so generation still runs on the raw
  // query — the transforms are computed and reported for the trace, but not
  // consumed downstream until the route-adaptor/retrieval stages exist.
  const content = await openAIChat("gpt-4o-mini", query);
  return NextResponse.json({
    content,
    queryUnderstanding: {
      count: transformedQueries.length,
      types: transformedQueries.map((t) => t.type),
    },
  });
}
