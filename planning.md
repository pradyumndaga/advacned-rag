# Planning — Advanced RAG with BullMQ, Multi-LLM, Multi-DB

Implementation roadmap for the pipeline defined in `specs.md`. Build in
phases, each one a complete vertical slice (per `AGENTS.md` §2: no tests
until a phase's feature is fully working end-to-end).

## Proposed folder structure

```
app/
  api/
    query/route.ts            # POST: accepts user query, enqueues pipeline job
    query/[id]/route.ts       # GET: poll/stream pipeline status + result
  page.tsx                    # chat/query UI
  layout.tsx
components/
  ui/                         # shadcn components only — installed via CLI
  chat/                       # feature components (message list, input, etc.)
  pipeline-trace/             # optional: visualizes CRAG journal / route decisions
lib/
  guardrails/
    input.ts
    output.ts
    rules.ts                  # deterministic pattern rules (defense in depth)
  llm/
    provider.ts                # LLMProvider interface
    router.ts                  # mini vs main tier selection
    providers/
      openai.ts
      anthropic.ts
  query-transform/
    stepback.ts
    rewrite.ts
    subquestions.ts
    hyde.ts
    index.ts                  # fan-out orchestration
  retrieval/
    route-adaptor.ts
    adapters/
      vector-db.ts
      keyword-db.ts
      sql-db.ts
      graph-db.ts
      types.ts                 # RetrievalAdapter interface
    ranker.ts
  generation/
    generate.ts
  crag/
    evaluate.ts
    keywords.ts
    journal.ts
  queue/
    connection.ts              # Redis connection for BullMQ
    queues.ts                  # queue definitions
    flow.ts                    # BullMQ flow wiring the stages together
  db/
    clients/                   # DB client singletons per data source
  types.ts                     # shared pipeline types (PipelineRequest, etc.)
  utils.ts                     # existing cn() helper
workers/
  index.ts                     # standalone worker process entrypoint
  processors/
    query-transform.processor.ts
    retrieval.processor.ts
    ranking.processor.ts
    generation.processor.ts
    crag-eval.processor.ts
    output-guardrails.processor.ts
specs.md
planning.md
AGENTS.md
CLAUDE.md
```

## Phase 0 — Infra scaffolding
- Add BullMQ + Redis client deps; `lib/queue/connection.ts`.
- Stand up `workers/index.ts` as a separate runnable process
  (`npm run worker`, or similar script alongside `dev`/`build`/`start`).
- Define shared types in `lib/types.ts` (mirrors `specs.md` §4).
- Env var plumbing for Redis URL, LLM API keys, DB connection strings —
  document required vars in `.env.example`.

## Phase 1 — Multi-LLM provider layer
- `lib/llm/provider.ts` interface + `lib/llm/router.ts` tier selection
  (mini/main).
- Implement at least two providers behind the interface (so routing is
  proven, not just designed for it).
- No pipeline logic yet — just prove `router.ts` can dispatch a completion
  call at either tier.

## Phase 2 — Input guardrails
- `lib/guardrails/input.ts`: mini-model classifier + `rules.ts` deterministic
  checks for impersonation, unauthorized-access phrasing, injection attempts,
  secret/PII fishing.
- Wire into `app/api/query/route.ts` as the very first step; short-circuit to
  a refusal on violation.
- This phase's "feature complete" bar: a query that should be blocked is
  blocked, a normal query passes through untouched.

## Phase 3 — Query understanding (mini model)
- Implement `stepback.ts`, `rewrite.ts`, `subquestions.ts`, `hyde.ts`.
- `query-transform/index.ts` fans these out as parallel BullMQ jobs
  (`queue:query-transform`) and collects results into
  `TransformedQuery[]`.

## Phase 4 — Route adaptor + multi-DB retrieval
- Define `RetrievalAdapter` interface; implement vector DB adapter first
  (minimum viable retrieval), then keyword/SQL/graph adapters.
- `route-adaptor.ts`: mini-model + heuristic classification from
  `TransformedQuery` → adapter selection.
- `queue:retrieval` jobs, one per (query, adapter) pair, run in parallel.

## Phase 5 — Ranking
- `ranker.ts`: score normalization across sources, de-dup, re-rank against
  the *original* query, truncate to token-budget-aware top-K.
- `queue:ranking` job depends on all retrieval jobs for the request
  (BullMQ flow parent/children).

## Phase 6 — Generation
- `generate.ts`: main-tier LLM call with original query + top-K context.
- `queue:generation` job.

## Phase 7 — CRAG self-correction loop
- `evaluate.ts`: mini-model scoring rubric (relevance, groundedness,
  completeness) against `{ query, context, response }`.
- `keywords.ts`: keyword extraction from failing response/context for
  retry seeding.
- `journal.ts`: structured `CragJournalEntry` (what went wrong, fix applied,
  keywords used) written on every failed attempt.
- Wire the retry loop: on failing score, feed keywords back into the route
  adaptor and re-run retrieval → ranking → generation → eval, capped at 3
  total attempts. On exhaustion, return the best-scoring attempt.

## Phase 8 — Output guardrails
- `lib/guardrails/output.ts`: same categories as input (impersonation,
  unauthorized access, sensitive info leakage) applied to the final response,
  including content that arrived via retrieved documents.
- Terminal `queue:output-guardrails` job; this is what `app/api/query/[id]`
  ultimately returns to the client.

## Phase 9 — UI
- Query input + streaming/polling result view (`app/page.tsx`,
  `components/chat/`) using shadcn components per `AGENTS.md` §1.
- Optional: `components/pipeline-trace/` to visualize route decisions and
  CRAG journal entries for debugging (dev-only surface, not shown to normal
  end users per `specs.md` §2.9).

## Phase 10 — Testing
- Only after Phases 0–9 work end-to-end for a real query. Cover: guardrail
  block/pass cases, route-adaptor classification, ranker merge/de-dup
  correctness, CRAG retry-loop attempt-cap enforcement, output guardrail
  redaction.

## Open decisions to confirm before/while implementing
- Which concrete LLM providers for mini vs main tier.
- Which concrete DBs for vector / keyword / SQL / graph (or which of the four
  are actually needed for v1 vs stubbed as future adapters). Vector DB is
  decided: **Qdrant Cloud** (see below), using an env-held API key for now,
  same pattern as `OPENAI_API_KEY`.
- CRAG score threshold and rubric weighting.
- Whether the pipeline trace/journal UI ships in v1 or is deferred.

## Future direction (deferred — not being built yet)
Current priority is learning/building the pipeline end-to-end; the following
is where the project may head afterward, not active scope. Captured here (and
in `specs.md` §0) so it isn't lost, but nothing below should block or shape
current work:
- Deploy on Vercel; move to fully BYOK credentials (LLM key + vector-DB
  credentials) entered client-side and kept in `localStorage`, never
  server-persisted.
- Worker/queue model rework: BullMQ's standalone worker process (as scoped in
  this doc's folder structure) can't run on Vercel's stateless functions.
  Would need either inline orchestration (current approach) to keep scaling,
  or a serverless-native job runner (Inngest, Trigger.dev, Vercel background
  functions).
- URL-based ingestion (fetch + extract + chunk), alongside/instead of file
  upload.
- `lib/llm/providers/openai.ts`'s client moving from a process-env-keyed
  singleton to a per-request client built from a visitor-supplied key.

Vector DB choice for whenever retrieval is built: **Qdrant Cloud** — REST-
native, which will matter once/if the BYOK+serverless direction above is
picked back up, but is a fine choice for local/env-key use today too.
