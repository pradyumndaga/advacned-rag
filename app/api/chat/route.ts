import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { inputGuardRails } from "@/lib/guardrails/input";
import { outputGuardRails } from "@/lib/guardrails/output";
import { transformQuery } from "@/lib/query-transform";
import { runCragLoop } from "@/lib/crag/orchestrate";
import { getResource } from "@/lib/ingestion/resource-store";
import { Citation } from "@/lib/types";
import { SourceType } from "@/lib/ingestion/types";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { query } = await request.json();

  if (typeof query !== "string" || !query.trim()) {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  const inputGuard = await inputGuardRails(query);
  if (!inputGuard.passed) {
    return NextResponse.json({ refused: true, reason: inputGuard.reason }, { status: 400 });
  }

  const transformedQueries = await transformQuery(query);
  const crag = await runCragLoop(query, transformedQueries);
  const outputGuard = await outputGuardRails(crag.content);

  // Every ranked doc from the winning attempt gets a citation entry, numbered
  // the same way generate.ts numbered them in the prompt ("[1]", "[2]", ...)
  // — the frontend only turns a "[N]" it finds in the answer text into a
  // clickable link, so which citations actually appear is driven entirely by
  // which ones the model referenced, not by anything reported here. Skipped
  // entirely if the output guardrail replaced the response with a refusal —
  // there's nothing in that text for a citation number to point at.
  const citations: Citation[] = outputGuard.action !== "refused"
    ? await Promise.all(
        crag.rankedDocs.map(async (doc, i) => {
          const sourceId = String(doc.metadata.sourceId ?? "");
          const resource = sourceId ? await getResource(sourceId) : null;
          return {
            index: i + 1,
            sourceId,
            sourceType: (doc.metadata.sourceType as SourceType) ?? "webpage",
            chunkIndex: Number(doc.metadata.chunkIndex ?? 0),
            label: resource?.label ?? sourceId,
          };
        })
      )
    : [];

  return NextResponse.json({
    content: outputGuard.content,
    lowConfidence: crag.lowConfidence,
    queryUnderstanding: {
      count: transformedQueries.length,
      types: transformedQueries.map((t) => t.type),
    },
    retrieval: {
      count: crag.retrievedCount,
      sources: Array.from(new Set(crag.rankedDocs.map((d) => d.source))),
    },
    ranking: {
      candidates: crag.retrievedCount,
      ranked: crag.rankedDocs.length,
    },
    crag: {
      attempts: crag.attempts,
      score: crag.evaluation.score,
      lowConfidence: crag.lowConfidence,
      journal: crag.journal,
    },
    outputGuardrail: {
      action: outputGuard.action,
      reason: outputGuard.reason,
    },
    citations,
  });
}
