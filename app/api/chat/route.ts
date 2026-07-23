import { NextResponse } from "next/server";
import { inputGuardRails } from "@/lib/guardrails/input";
import { transformQuery } from "@/lib/query-transform";
import { retrieveForQueries } from "@/lib/retrieval/retrieve";
import { rankDocs } from "@/lib/retrieval/ranker";
import { generateAnswer } from "@/lib/generation/generate";
import { getResource } from "@/lib/ingestion/resource-store";
import { Citation } from "@/lib/types";

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
  const content = await generateAnswer(query, rankedDocs);

  // Every ranked doc gets a citation entry, numbered the same way generate.ts
  // numbered them in the prompt ("[1]", "[2]", ...) — the frontend only turns
  // a "[N]" it finds in the answer text into a clickable link, so which
  // citations actually appear is driven entirely by which ones the model
  // referenced, not by anything reported here.
  const citations: Citation[] = await Promise.all(
    rankedDocs.map(async (doc, i) => {
      const sourceId = String(doc.metadata.sourceId ?? "");
      const resource = sourceId ? await getResource(sourceId) : null;
      return {
        index: i + 1,
        sourceId,
        chunkIndex: Number(doc.metadata.chunkIndex ?? 0),
        label: resource?.label ?? sourceId,
      };
    })
  );

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
    citations,
  });
}
