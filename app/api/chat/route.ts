import { NextResponse } from "next/server";
import { openAIChat } from "@/lib/llm/providers/openai";
import { inputGuardRails } from "@/lib/guardrails/input";
import { transformQuery } from "@/lib/query-transform";
import { retrieveForQueries } from "@/lib/retrieval/retrieve";
import { rankDocs } from "@/lib/retrieval/ranker";

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
  const rankedDocs = await rankDocs(query, retrievedDocs);

  // Context assembly/generation still runs on the raw query — ranking is
  // computed and reported for the trace, but generation doesn't consume the
  // ranked context yet until Phase 8 wires it in.
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
    ranking: {
      candidates: retrievedDocs.length,
      ranked: rankedDocs.length,
    },
  });
}
