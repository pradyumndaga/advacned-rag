# Planning — Advanced RAG with BullMQ, Multi-LLM, Multi-DB

Implementation roadmap for the pipeline defined in `specs.md`. Build in
phases, each one a complete vertical slice (per `AGENTS.md` §2: no tests
until a phase's feature is fully working end-to-end).

## Proposed folder structure

```
app/
  api/
    query/route.ts            # POST: accepts user query, enqueues pipeline job
    ingest/route.ts            # POST: accepts a file or URL, creates a resource,
                                # enqueues the ingest-source job [Phase 4 ✅]
    resources/route.ts        # GET: resource list + status, for panel polling [✅]
    resources/[id]/route.ts    # GET: resource + reconstructed chunks for preview [✅]
  page.tsx                    # chat/query UI
  layout.tsx
components/
  ui/                         # shadcn components only — installed via CLI
  chat/                       # feature components (message list, input, etc.)
  pipeline-trace/             # optional: visualizes CRAG journal / route decisions
  resources/
    resource-panel.tsx        # left-hand grouped list (queued/processing/ready)
    resource-preview.tsx       # dialog/slide-over, shared with citation click-through
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
    index.ts                  # fan-out orchestration (Promise.allSettled, not BullMQ)
  ingestion/
    types.ts                  # SourceLoader interface, LoadedDocument union
    loaders/
      pdf.ts
      markdown.ts
      srt.ts
      vtt.ts                   # shares cue-parsing core with srt.ts
      youtube.ts                # fetches captions, reuses SRT/VTT cue shape
      webpage.ts                # fetch + readability-style extraction
    chunkers/
      time-window.ts            # for timed cues (SRT/VTT/YouTube)
      token-budget.ts            # for plain text (PDF/Markdown/webpage)
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
    queues.ts                  # queue definitions (ingest-source, ingest-chunk, ...) [✅]
    flow.ts                    # BullMQ flow wiring the stages together
  db/
    clients/                   # DB client singletons per data source
  types.ts                     # shared pipeline types (PipelineRequest, etc.)
  utils.ts                     # existing cn() helper
workers/
  index.ts                     # standalone worker process entrypoint
  processors/
    ingest-source.processor.ts # [✅] parent job: load -> chunk -> fan out children
    ingest-chunk.processor.ts  # [✅] child job: embed + upsert one chunk
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
- Define shared types in `lib/types.ts` (mirrors `specs.md` §6).
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
- `query-transform/index.ts` fans these out in-process via
  `Promise.allSettled` and collects results into `TransformedQuery[]`.
  Deliberately **not** BullMQ — see `specs.md` §5 for why this stage doesn't
  benefit from queueing (tried, then reverted).

## Phase 4 — Ingestion ✅ implemented
- `lib/ingestion/types.ts`: `SourceLoader` interface + `LoadedDocument` union
  (`text` vs `timed` cues) — see `specs.md` §2. One deviation from the spec's
  literal interface: loaders take `{ fileBuffer?: Buffer; fileName?: string;
  url?: string }`, not a raw `File` — a browser `File` can't survive BullMQ's
  JSON job-data serialization, so `app/api/ingest/route.ts` reads the upload
  into a `Buffer` (base64 in job data) before handing it to the worker.
- Source loaders (`lib/ingestion/loaders/`): `pdf.ts` (via `unpdf`),
  `markdown.ts`, `srt.ts`/`vtt.ts` (share `cues.ts`'s cue-parsing core),
  `youtube.ts` (via the `youtube-transcript` package, reuses the SRT/VTT cue
  shape), `webpage.ts` (`fetch` + `@mozilla/readability`/`jsdom`).
- Chunkers (`lib/ingestion/chunkers/`): `time-window.ts` (~45s windows) and
  `token-budget.ts` (1200-char budget, 150-char overlap).
- `lib/db/qdrant.ts`: Qdrant client singleton, collection auto-create +
  payload index on `sourceId` (Qdrant Cloud requires an explicit index
  before a field can be used in a scroll/search filter — found this live
  during testing), `upsertChunk`, `fetchChunksBySource`.
- `lib/ingestion/resource-store.ts`: resource lifecycle state lives in Redis
  (same instance BullMQ already uses) — one JSON blob per resource id plus a
  sorted-set index, resolving the "where does lifecycle state live" open
  decision below in favor of not standing up a new store.
- Queues are named `ingest-source` (parent: load + chunk, then fans out
  children) and `ingest-chunk` (child: embed + upsert one chunk, `attempts:
  3` with exponential backoff) rather than a single `queue:ingestion` —
  `workers/processors/ingest-source.processor.ts` uses BullMQ's manual
  parent/children pattern (`job.moveToWaitingChildren` + `WaitingChildrenError`)
  since the child count isn't known until after loading/chunking runs.
  Verified live: a transient Qdrant collection-creation race under
  concurrent chunk jobs threw once and was auto-retried successfully —
  exactly the per-chunk retry behavior this architecture was built for.
- `app/api/ingest/route.ts`: `POST`, multipart (file kinds) or JSON (URL
  kinds), creates the resource record and enqueues the parent job.
- `app/api/resources/route.ts` / `app/api/resources/[id]/route.ts`: list +
  single-resource-with-reconstructed-chunks, for the panel (Phase 5).
- Verified live against one real source of each type: PDF, Markdown, SRT,
  web page (including the failure path — an unreachable URL correctly lands
  in `failed` with an error message). YouTube loader is implemented but not
  yet verified against a real video in this pass.

## Phase 5 — Resources panel & preview ✅ implemented
- `components/resources/resource-panel.tsx`: left-hand panel, polls
  `GET /api/resources` while anything is unsettled, groups resources into
  the three visible states from `specs.md` §3.1 (Queued, Processing, Ready).
  Failed resources are surfaced inside the **Processing** group with a red
  dot (a concrete resolution of "wherever they'd otherwise sit" — we don't
  track which state a resource failed from, and most failures happen
  mid-processing anyway).
- `components/resources/resource-preview.tsx`: dialog opened on click,
  reconstructs content from stored chunks (filter by `sourceId`, sort by
  `chunkIndex`) — plain-text render for PDF/Markdown/web page, timestamped
  transcript render for SRT/VTT/YouTube. Accepts an optional `chunkId` to
  scroll to/highlight, since citation click-through (Phase 8) will reuse
  this exact component.
- `app/page.tsx` layout: three-column grid (Resources | Chat | pipeline
  trace); `IngestPanel` no longer holds its own local source list — it
  triggers real uploads to `/api/ingest` and bumps a `refreshSignal` so the
  resources panel refetches immediately instead of waiting for its next
  poll tick.
- Verified live in-browser: uploading a file shows a per-card spinner, the
  resource appears in the panel within one refresh, and clicking a ready
  resource opens the correct preview (plain text and timestamped transcript
  both confirmed).

## Phase 6 — Route adaptor + multi-DB retrieval ✅ implemented
- `lib/retrieval/adapters/types.ts`: `RetrievalAdapter` interface.
- `lib/retrieval/adapters/vector-db.ts`: real adapter against Qdrant Cloud —
  embeds the transformed query (or reuses HyDE's existing embedding),
  `lib/db/qdrant.ts`'s new `searchChunks` does the similarity search, maps
  results to `RetrievedDoc`. Verified against the real Phase 4 ingested data,
  not a fixture (30 chunks back for 6 transformed queries × top-5).
- `lib/retrieval/route-adaptor.ts`: **heuristic-only, no mini-LLM call** —
  deviates from the original "mini-model + heuristic classification" plan.
  Reasoning: keyword/SQL/graph adapters don't exist yet, so classifying a
  query into one of four destinations when three don't resolve to anything
  real would be pure LLM cost/latency with zero observable behavior
  difference (100% of outcomes are "use vector" either way) — the same
  "does this stage actually benefit" test this project already applied when
  reverting BullMQ on query-transform (specs.md §5). `routeQuery` always
  returns `["vector"]` for now; the function signature and `AdapterTarget`
  union already cover all four so adding real classification later, once a
  second adapter exists, is a small diff not a rewrite.
- `lib/retrieval/retrieve.ts`: fans out retrieval **in-process via
  `Promise.allSettled`, not `queue:retrieval`** — another deviation from the
  original plan, same reasoning as query-transform: the chat API route has
  to synchronously await these results before ranking/generation, so a
  queue would only add Redis round-trip latency with no fire-and-forget
  benefit. `specs.md` §5 updated to reflect this.
- Wired into `app/api/chat/route.ts` and surfaced as real `route-adaptor`
  and `retrieval` trace lines in the UI (not simulated), same pattern as
  query-understanding. Generation still doesn't consume the retrieved docs
  yet — that's ranking/context-assembly (Phase 7/8).

## Phase 7 — Ranking ✅ implemented
- `lib/retrieval/ranker.ts`: `rankDocs(originalQuery, docs)`.
  - **De-dup**: by chunk id (exact-duplicate), keeping the highest-scoring
    occurrence — retrieval runs once per transformed query, so the same
    chunk routinely comes back multiple times. Fuzzy near-duplicate
    detection across *different* chunks is deferred until there's evidence
    it's needed (today there's one adapter, so nothing produces
    near-duplicates from separate sources).
  - **Score normalization across sources**: not implemented as real logic —
    with only the vector adapter existing, every candidate already shares
    one metric (cosine similarity), so there's nothing to normalize yet.
    Becomes real once a second adapter with a different scoring scale
    exists.
  - **Re-rank against the original query**: re-embeds the original query and
    computes cosine similarity against each deduped candidate's own stored
    vector (carried through `RetrievedDoc.metadata.vector` from the vector
    adapter, stripped again before the ranked docs leave the ranker) —
    corrects for the fact a doc's retrieval score reflects relevance to
    whichever transformed query fetched it, not what the user actually
    asked.
  - **Truncate**: top-8, plus a ~6000-char running budget (same
    character-budget-as-token-proxy style as the ingestion chunker) so a
    handful of long chunks can't blow past what generation can use.
- **Not queued** — same reasoning as retrieval (§6 below): the chat route
  has to synchronously await ranking before generation runs, so
  `queue:ranking` (BullMQ flow parent/children, as originally planned) would
  add latency with no fire-and-forget benefit. Runs as a plain function call
  in `lib/retrieval/ranker.ts`.
- Wired into `app/api/chat/route.ts` and surfaced as a real `ranking` trace
  line (`"N candidates → M after de-dup + re-rank"`). Verified live: 40
  retrieved candidates deduped/re-ranked down to 7. Generation still
  doesn't consume the ranked docs yet — that's Phase 8.

## Phase 8 — Generation
- `generate.ts`: main-tier LLM call with original query + top-K context.
- Track which `RetrievedDoc.id`s contributed to the response so it can carry
  citations (`specs.md` §4.6) — wire citation click-through in the chat UI to
  open `components/resources/resource-preview.tsx` (from Phase 5) with the
  cited chunk, rather than building a second preview surface.
- `queue:generation` job.

## Phase 9 — CRAG self-correction loop
- `evaluate.ts`: mini-model scoring rubric (relevance, groundedness,
  completeness) against `{ query, context, response }`.
- `keywords.ts`: keyword extraction from failing response/context for
  retry seeding.
- `journal.ts`: structured `CragJournalEntry` (what went wrong, fix applied,
  keywords used) written on every failed attempt.
- Wire the retry loop: on failing score, feed keywords back into the route
  adaptor and re-run retrieval → ranking → generation → eval, capped at 3
  total attempts. On exhaustion, return the best-scoring attempt.

## Phase 10 — Output guardrails
- `lib/guardrails/output.ts`: same categories as input (impersonation,
  unauthorized access, sensitive info leakage) applied to the final response,
  including content that arrived via retrieved documents.
- Terminal `queue:output-guardrails` job; this is what `app/api/query/[id]`
  ultimately returns to the client.

## Phase 11 — UI polish
- Query input + streaming/polling result view (`app/page.tsx`,
  `components/chat/`) using shadcn components per `AGENTS.md` §1.
- Optional: `components/pipeline-trace/` to visualize route decisions and
  CRAG journal entries for debugging (dev-only surface, not shown to normal
  end users per `specs.md` §4.9).
- By this phase the ingestion source grid (built earlier) and resources
  panel/preview (Phase 5) already exist — this phase is about the overall
  layout coming together (ingestion + resources panel + chat + trace), not
  building new upload/resource surfaces from scratch.

## Phase 12 — Testing
- Only after Phases 0–11 work end-to-end for a real query. Cover: guardrail
  block/pass cases, ingestion loader/chunker correctness per source type,
  resource lifecycle state transitions (including failure + retry),
  route-adaptor classification, ranker merge/de-dup correctness, CRAG
  retry-loop attempt-cap enforcement, output guardrail redaction.

## Open decisions to confirm before/while implementing
- Which concrete LLM providers for mini vs main tier.
- Which concrete DBs for vector / keyword / SQL / graph (or which of the four
  are actually needed for v1 vs stubbed as future adapters). Vector DB is
  decided: **Qdrant Cloud** (see below), using an env-held API key for now,
  same pattern as `OPENAI_API_KEY`.
- CRAG score threshold and rubric weighting.
- Whether the pipeline trace/journal UI ships in v1 or is deferred.
- ~~Web page loader's readability/extraction approach~~ — resolved:
  `@mozilla/readability` + `jsdom`.
- ~~YouTube caption fetching approach~~ — resolved: the `youtube-transcript`
  package; not yet verified against a real video (see Phase 4 notes).
- ~~Where per-resource lifecycle state lives~~ — resolved: Redis (same
  instance BullMQ already uses), one JSON blob per resource id.
- Resource status delivery: polling `GET /api/resources` (assumed for v1,
  `specs.md` §3.1) vs. a push channel (SSE/WebSocket) — revisit only if
  polling proves too slow/heavy in practice. Still open.
- No delete/retry action on a resource yet (not requested) — a `failed`
  resource's error is visible via tooltip but there's no way to retry
  ingestion or remove a resource from the panel without going to Redis
  directly. Revisit if that friction shows up in practice.

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
- `lib/llm/providers/openai.ts`'s client moving from a process-env-keyed
  singleton to a per-request client built from a visitor-supplied key.

Vector DB choice for whenever retrieval is built: **Qdrant Cloud** — REST-
native, which will matter once/if the BYOK+serverless direction above is
picked back up, but is a fine choice for local/env-key use today too.
