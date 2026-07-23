import { NextResponse } from "next/server";
import { openAIChat } from "@/lib/llm/providers/openai";
import { inputGuardRails } from "@/lib/guardrails/input";
import { transformQuery } from "@/lib/query-transform";
import { retrieveForQueries } from "@/lib/retrieval/retrieve";

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
  const retrievedDocs = await retrieveForQueries(transformedQueries);

  // Ranking/context-assembly aren't built yet, so generation still runs on
  // the raw query — retrieval is computed and reported for the trace, but
  // not consumed by generation until ranking (Phase 7) assembles context.
  const content = await openAIChat("gpt-4o-mini", query);
  return NextResponse.json({
    content,
    queryUnderstanding: {
      count: transformedQueries.length,
      types: transformedQueries.map((t) => t.type),
    },
    retrieval: {
      count: retrievedDocs.length,
      sources: Array.from(new Set(retrievedDocs.map((d) => d.source))),
    },
  });
}
