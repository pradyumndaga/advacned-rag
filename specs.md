# Specs — Advanced RAG System

Technical specification for the retrieval-augmented generation system this
app implements. Pair this with `planning.md` (phased build order) and
`AGENTS.md` (how the agent must work while building it).

## 0. Deployment target & credential model (future direction, not current)

Primary goal right now is learning/building the pipeline end-to-end; this
section is where the project is headed eventually, not a constraint on the
current build. Until this is revisited explicitly, keep using a single
env-held API key per provider (`OPENAI_API_KEY`, and similarly for whichever
vector-DB SDK gets added), same pattern as every other credential in the repo
today — no per-request/BYOK plumbing yet.

Eventual target: deploy on Vercel — Next.js API routes run as stateless,
ephemeral serverless functions. That constrains several of the sections
below, once we get there:

- **No server-held credentials.** There is no operator-owned LLM key or
  vector-DB account. Every visitor supplies their own LLM API key *and* their
  own vector-DB credentials (BYOK for the full stack, not just the LLM).
  Credentials are entered client-side and kept in `localStorage` only — never
  written to a database, log, or any server-side store.
- **Per-request credential passthrough.** Server-side code must not read
  provider credentials from `process.env` (aside from local dev convenience).
  Every call into `lib/llm/` and `lib/retrieval/adapters/` receives the
  caller's credentials as an explicit argument, threaded from the API route
  that received them on the request. `lib/llm/providers/openai.ts`'s current
  module-level singleton client (built once from `process.env`) is a known gap
  against this model and needs to become per-request before this ships.
- **No server-side persistence of ingested content across requests implied.**
  Since the vector store is the visitor's own account, ingestion writes go
  directly to *their* store via their credentials — the app itself holds no
  document index.
- **No long-running worker process.** Serverless functions can't host a
  persistent BullMQ worker (`workers/index.ts` per `planning.md`'s proposed
  structure assumes a standalone long-running process). Either the pipeline
  stays orchestrated inline within the request/response cycle (as it is
  today, without a queue), or a serverless-compatible job runner (e.g.
  Vercel-native background functions, Inngest, Trigger.dev) replaces BullMQ.
  Unresolved — see `planning.md`'s open decisions.
- **Ingestion accepts URLs, not just file upload.** The existing PDF dropzone
  UI needs a URL-based ingestion path alongside (or instead of) file upload,
  since visitors are pointing the app at content to index, not necessarily
  uploading local files.

## 1. High-level pipeline (query-time)

```
User Query
   │
   ▼
[Input Guardrails] ──reject/sanitize──▶ Refusal response
   │ pass
   ▼
[Query Understanding — mini LLM]
   ├─ Stepback prompting
   ├─ Rewrite prompting
   ├─ Sub-question decomposition
   └─ HyDE (hypothetical document embedding)
   │  (produces a set of transformed queries)
   ▼
[Route Adaptor] ── classifies each (sub)query → target data source(s)
   │
   ▼
[Multi-DB Retrieval] (vector / keyword / SQL / graph, per route decision)
   │
   ▼
[Ranking] — merge + re-rank all candidate documents across sources
   │
   ▼
[Context Assembly] — top-K ranked docs + ORIGINAL user query
   │
   ▼
[Generation — main LLM]
   │
   ▼
[CRAG Evaluation — mini LLM] ── score response against query/context
   │
   ├─ score ≥ threshold ──▶ [Output Guardrails] ──▶ Final response
   │
   └─ score < threshold (attempt < 3):
         ├─ extract keywords from failing response/context
         ├─ journal: what went wrong + what fix was attempted
         ├─ feed keywords back into [Route Adaptor]
         └─ retry generation (max 3 total attempts)
             │ attempt 3 still fails
             ▼
         [Output Guardrails] ──▶ best-effort response + low-confidence notice
```

This is the *query-time* flow — it assumes the vector DB already has content
in it. §2 covers how content gets there.

## 2. Ingestion pipeline (upload/index-time)

A separate, asynchronous pipeline from §1 — it runs when a visitor adds a
source to the index, not when they ask a question. Supported source types:
**PDF, Markdown, SRT, VTT, YouTube link, web page URL.**

```
Source (file upload or URL)
   │
   ▼
[Source Loader] — one per source type, normalizes into a common shape:
   ├─ PDF          → plain text
   ├─ Markdown     → plain text
   ├─ SRT          → timed cues { start, end, text }
   ├─ VTT          → timed cues (shares cue-parsing core with SRT)
   ├─ YouTube link → fetch caption track → timed cues (same shape as SRT/VTT)
   └─ Web page URL → fetch HTML → extract main content → plain text
   │
   ▼
[Chunker] — strategy depends on the loader's output shape:
   ├─ plain text  → character/token-budget chunking, with overlap
   └─ timed cues  → time-window chunking (~30–60s per chunk, keeps start/end)
   │
   ▼
[Embed] — each chunk embedded via the embedding model (`openAIEmbed`)
   │
   ▼
[Upsert] — chunk + embedding + metadata → vector DB (Qdrant Cloud)
```

### 2.1 Source loaders (`lib/ingestion/loaders/`)
One loader per source type, all implementing a common interface:

```ts
type LoadedDocument =
  | { kind: "text"; text: string }
  | { kind: "timed"; cues: { start: number; end: number; text: string }[] };

interface SourceLoader {
  type: "pdf" | "markdown" | "srt" | "vtt" | "youtube" | "webpage";
  load(input: { file?: File; url?: string }): Promise<LoadedDocument>;
}
```

- `pdf.ts` / `markdown.ts` / `webpage.ts` → `{ kind: "text" }`. The web page
  loader needs readability-style extraction (strip nav/ads/scripts/
  boilerplate) before the HTML is chunk-worthy — a raw DOM dump is not plain
  text.
- `srt.ts` / `vtt.ts` → `{ kind: "timed" }`. SRT and VTT are near-identical
  cue formats (VTT adds a `WEBVTT` header and uses `.` instead of `,` in
  timestamps) — share one cue-parsing core with a thin per-format
  normalization step, not two independent parsers.
- `youtube.ts` → `{ kind: "timed" }`. Fetches the video's existing caption
  track (not the audio/video itself) and reuses the exact same cue shape as
  SRT/VTT, so it reuses the same time-window chunker rather than needing its
  own.

### 2.2 Chunking (`lib/ingestion/chunkers/`)
- **Time-window chunking** (SRT/VTT/YouTube) — merge consecutive cues into
  ~30–60s windows, concatenating their text, keeping the window's `start`/
  `end` as chunk metadata. The point: retrieval can cite "around 2:15" for a
  transcript source, which only survives if chunking preserves real
  timestamps rather than chunking by raw character count.
- **Character/token-budget chunking** (PDF/Markdown/web page) — standard
  fixed-size chunking with overlap; no inherent timestamp concept for these
  source types.

### 2.3 Metadata
Every ingested chunk carries at minimum `{ sourceType, sourceId, chunkIndex }`
(`sourceId` is the file name or source URL), plus `{ startTime, endTime }` for
chunks that came from a timed source. This flows straight into
`RetrievedDoc.metadata` (§6 Data model) so ranking/citation can use it later,
and is exactly what §3's resource preview reconstructs a source's content
from.

### 2.4 Orchestration
Per §5's orchestration decision, ingestion — not query-transform — is the
pipeline stage that actually benefits from BullMQ: it can be long-running,
benefits from per-chunk retries (one failed embed shouldn't lose an entire
document), and doesn't need to block the visitor waiting on it. One BullMQ
job per chunk (embed + upsert), fanned out from a parent ingestion job per
source.

## 3. Resources UI & citation preview

A visitor needs to see what they've added and what state it's in, and later
(once generation ships) needs to be able to click through from an answer's
citation to the exact source material it came from. Both needs share one
underlying model and one preview component — this section defines both.

### 3.1 Resource lifecycle
Every ingested source moves through a small state machine, tracked
server-side and surfaced in the UI as it changes:

```
uploading → queued → processing → ready
    │           │          │
    └───────────┴──────────┴────────────▶ failed
```

- **uploading** — file bytes are still transferring from browser to server.
  URL-based sources (YouTube, web page) skip this state entirely — there's
  no file to transfer, just a URL string to hand off.
- **queued** — server has the source; a `queue:ingestion` job exists,
  waiting for the worker process to pick it up.
- **processing** — the worker is actively running loader → chunker → embed
  → upsert (§2) for this source.
- **ready** — terminal success state. Fully indexed, searchable, and
  available for retrieval and preview.
- **failed** — terminal error state, reachable from any state above (bad
  file, unreachable URL, a YouTube video with no captions available, an
  embedding API error, etc.). Carries an error message and is retryable —
  ingestion failures are common enough in practice (especially for
  URL-based sources) that surfacing *why* and letting the visitor retry
  matters more than a generic "failed" label would.

The UI collapses this into three visible groups — **Queued** (uploading +
queued together — from the visitor's point of view both just mean "not
started processing yet"), **Processing**, and **Ready** — plus failed items
surfaced with a red status dot wherever they'd otherwise sit, rather than a
fourth always-visible group that's usually empty. Status is a colored dot
(+ a spinner while active) next to each resource, not a text label:
gray = queued, animated amber/blue = processing, green = ready, red = failed.

Reflecting status changes as they happen requires the client to learn about
them somehow, since ingestion runs in the separate worker process. Polling
`GET /api/resources` while anything is `queued`/`processing`/`uploading`,
stopping once everything's settled, is the pragmatic v1 approach — a push
channel (SSE/WebSocket) would make updates feel instant but isn't justified
at this scale yet. Revisit if the resource list grows large or latency to
reflect a status change actually matters.

### 3.2 Resources panel (`components/resources/`)
A left-hand panel, visible alongside the chat and pipeline-trace columns,
listing every resource added this session grouped by the three visible
states from §3.1. Clicking any resource opens its preview (§3.3).

### 3.3 Resource preview (shared with citation click-through)
Clicking a resource opens its content in-app — a dialog or slide-over, never
a download or a new tab. This is deliberately the *same component* that
citation click-through will use later, once generation (§4.6) ships:
clicking a citation in a CRAG-approved answer opens this exact preview,
scrolled to and highlighting the specific chunk that was cited, not just
"here's the whole document it came from."

```ts
interface ResourcePreviewTarget {
  sourceId: string;
  chunkId?: string; // set when opened from a citation — scroll/highlight this chunk
}
```

Preview content is *reconstructed from the chunks already stored in the
vector DB* — filter by `metadata.sourceId`, sort by `metadata.chunkIndex`,
concatenate — rather than keeping a second copy of the raw document in a
separate store. That's why §2.3's chunk metadata carries `sourceId` and
`chunkIndex`: this preview and the future citation feature are both built on
exactly that.

Rendering differs by the source's original shape (§2.1):
- **Plain-text sources** (PDF/Markdown/web page) — render the reconstructed
  text, scrolled to the cited chunk's position when opened from a citation.
- **Timed sources** (SRT/VTT/YouTube) — render as a transcript with visible
  timestamps, scrolled to and highlighting the cited chunk's `startTime`–
  `endTime` window when opened from a citation.

## 4. Components (query-time)

### 4.1 Input Guardrails (`lib/guardrails/input.ts`)
Runs before any query transformation.
- Block/flag prompt-injection and instruction-override attempts embedded in
  the user query.
- Block impersonation attempts (queries asking the system to act as, or claim
  to be, a specific real person, admin, or another system/user).
- Block requests for unauthorized access (privilege escalation phrasing,
  "ignore previous instructions", requests to bypass auth/roles).
- Block requests explicitly fishing for secrets/PII/credentials.
- On violation: short-circuit the pipeline and return a refusal — do not
  proceed to query understanding or retrieval.
- Implemented as a mini-LLM classifier plus deterministic pattern rules
  (defense in depth — don't rely on the LLM alone).

### 4.2 Query Understanding — mini model (`lib/query-transform/`)
Given the (guardrail-passed) query, produce a bounded set of transformed
queries:
- `stepback.ts` — generates a more general/abstracted version of the query.
- `rewrite.ts` — clarifies ambiguity, expands acronyms, normalizes phrasing.
- `subquestions.ts` — decomposes multi-part questions into independent
  sub-questions (capped, e.g. max 5).
- `hyde.ts` — generates a hypothetical answer document, embedded and used as
  a retrieval query vector.

All four run off a small/cheap model (see §4.7 Multi-LLM), fanned out
in-process via `Promise.allSettled` (`query-transform/index.ts`) — **not**
BullMQ. See §5 Orchestration for why this stage is deliberately not queued.
Outputs are independent — no step depends on another's output.

### 4.3 Route Adaptor (`lib/retrieval/route-adaptor.ts`)
Classifies each transformed query and selects which data source(s) to query:
- Vector DB — semantic/unstructured content.
- Keyword/full-text store — exact-match, code, IDs, names.
- SQL DB — structured/tabular/aggregatable data.
- Graph DB — relationship/multi-hop queries.

**Current implementation: heuristic-only, no mini-LLM call.** Only the
vector adapter exists (§4.4), so classifying a query into one of four
destinations when three don't resolve to anything real would be LLM
cost/latency with zero observable behavior difference — every outcome is
"use vector" either way. `routeQuery` always returns `["vector"]` for now;
the function signature already covers all four targets so real mini-LLM
classification is a small addition once a second adapter exists, not a
rewrite. Still the re-entry point for CRAG's keyword-feedback retry loop
once that's built.

### 4.4 Multi-DB Retrieval (`lib/retrieval/adapters/`)
One adapter per data source implementing a common interface:

```ts
interface RetrievalAdapter {
  name: string;
  retrieve(query: TransformedQuery, opts?: RetrieveOptions): Promise<RetrievedDoc[]>;
}
```

Only the vector adapter (`adapters/vector-db.ts`) is implemented — against
Qdrant Cloud, using the same collection Phase 4 ingestion writes to. It
embeds the transformed query's text (or reuses HyDE's embedding directly,
since that's already a vector meant for retrieval) and calls Qdrant's
similarity search. Keyword/SQL/graph adapters are deferred until there's
real data of those shapes to query — building them now against no data
would be exactly the kind of speculative work `AGENTS.md` §4 rules out.

For now, adapters read their DB credentials from `process.env`, same pattern
as `lib/llm/providers/openai.ts` today. (Future direction per §0: BYOK,
credentials threaded per-request instead — not yet.)

Adapters run in parallel per routed query, fanned out in-process via
`Promise.allSettled` (`lib/retrieval/retrieve.ts`) — **not** BullMQ; see §5
for why. Each `RetrievedDoc` carries `{ id, content, source, sourceScore,
metadata }`.

### 4.5 Ranking (`lib/retrieval/ranker.ts`)
Merges candidate docs across sources/queries and produces a single ranked
list:
- Normalize per-source scores onto a common scale.
- De-duplicate near-identical documents.
- Re-rank (cross-encoder or LLM-based re-ranker) against the *original* user
  query, not the transformed queries.
- Truncate to top-K for context assembly (K configurable, token-budget
  aware).

### 4.6 Generation (`lib/generation/generate.ts`)
Main LLM call: original user query + top-K ranked context → response.
Uses the "main" model tier (see §4.7), not the mini model. Tracks which
`RetrievedDoc.id`s actually contributed to the response, so the answer can
carry citations pointing back to specific chunks — which is what §3.3's
preview click-through opens against.

### 4.7 Multi-LLM routing (`lib/llm/`)
Provider-agnostic layer with two model tiers, selected per pipeline stage:
- **Mini tier** — guardrail classification, query transforms, route
  classification, CRAG scoring, keyword extraction, journaling. Optimized for
  cost/latency.
- **Main tier** — final answer generation. Optimized for quality.

```ts
interface LLMProvider {
  name: string;
  complete(input: LLMRequest): Promise<LLMResponse>;
}
```

`lib/llm/router.ts` selects provider + tier per call; providers are pluggable
(OpenAI, Anthropic, local, etc.) behind this interface so no call site depends
on a specific vendor SDK. For now, keys come from `process.env`, same as the
rest of the repo. (Future direction per §0: per-request BYOK — not yet.)

### 4.8 CRAG evaluation (`lib/crag/evaluate.ts`)
Mini model scores the generated response against `{ original query, context
used, response }` on a defined rubric (relevance, groundedness/faithfulness
to context, completeness). Returns a numeric score + rationale.
- Threshold and max attempts are configurable; default **max 3 attempts**.
- On failing score: extract keywords (`lib/crag/keywords.ts`) from the
  response/context to re-seed retrieval, and re-enter the Route Adaptor.
- After 3 failed attempts: return the best-scoring response of the three,
  through Output Guardrails, with a low-confidence flag rather than blocking
  the user entirely.

### 4.9 CRAG journal (`lib/crag/journal.ts`)
On every failed attempt, the CRAG mini model records a structured entry:

```ts
interface CragJournalEntry {
  attempt: number;
  score: number;
  whatWentWrong: string;   // mini-model diagnosis
  fixApplied: string;      // e.g. "re-routed to graph DB with keywords [...]"
  keywordsUsed: string[];
}
```

Journal entries are attached to the pipeline job (BullMQ job data) for
observability/debugging and optionally surfaced in the UI's pipeline trace
view. Not shown to the end user by default.

### 4.10 Output Guardrails (`lib/guardrails/output.ts`)
Runs on the final response before it's returned, regardless of which attempt
produced it:
- Prevent impersonation (system claiming to be a real person/authority it
  isn't).
- Prevent statements or instructions that would grant/imply unauthorized
  access.
- Redact/block leakage of secrets, credentials, internal system details, or
  PII that shouldn't be exposed, including anything surfaced via retrieved
  documents.
- On violation: strip/replace the offending content or fall back to a safe
  refusal — never forward raw offending content to the user "for
  transparency."

## 5. Orchestration — BullMQ

Not every stage that talks to an LLM or an external DB is a BullMQ job —
queueing earns its cost when the producer doesn't need to wait around for the
result. Stages evaluated against that bar so far:

- **Query-transform (§4.2): deliberately *not* queued.** The API route still
  has to synchronously await all four transforms before it can respond to
  the user — there's no "fire and forget" here. Routing it through BullMQ
  (tried, then reverted) only added Redis round-trip latency and a new
  failure mode (`/api/chat` hanging if the worker process was down) with zero
  benefit: no retry semantics beyond what `Promise.allSettled` already gave
  it, no concurrency control needed at "4 calls per request", no scaling
  benefit at this volume. Stays a plain in-process fan-out.
- **Retrieval (§4.4): same reasoning, not queued.** The chat route has to
  synchronously await retrieval before ranking/generation can run — no
  fire-and-forget benefit, and at "one adapter, a handful of queries per
  request" there's no concurrency/scaling need a queue would solve. Fanned
  out via `Promise.allSettled` in `lib/retrieval/retrieve.ts` instead of a
  `queue:retrieval` this spec originally called for.
- **Ingestion (§2.4): the actual right fit.** Long-running (can exceed a
  request/serverless timeout entirely), doesn't need to block the visitor,
  benefits genuinely from per-chunk retries and rate-limiting on embedding
  calls. This is where BullMQ earns its complexity.

Queues:
- `queue:ingestion` — implemented as `ingest-source` (parent: load + chunk)
  and `ingest-chunk` (child: embed + upsert one chunk, retried
  independently), fanned out via BullMQ's manual parent/children pattern
  (§2.4).
- `queue:ranking` — single job, depends on all retrieval jobs for that
  request.
- `queue:generation` — single job.
- `queue:crag-eval` — single job; enqueues a follow-up retrieval round on
  failure (up to the attempt cap) instead of looping in-process.
- `queue:output-guardrails` — single job, terminal.

A parent "pipeline" job (or BullMQ flow) tracks overall request state and
attempt count. Redis is the queue backend; connection config lives in
`lib/queue/connection.ts`. Workers run as a standalone process (`workers/`),
not inside Next.js request handlers — which also means anything routed
through a queue only works while `npm run worker` is running.

## 6. Data model (indicative)

```ts
interface TransformedQuery {
  type: "stepback" | "rewrite" | "subquestion" | "hyde";
  text: string;
  embedding?: number[];
}

interface RetrievedDoc {
  id: string;
  content: string;
  source: string;
  sourceScore: number;
  metadata: Record<string, unknown>; // see §2.3 for what ingestion puts here
}

interface PipelineRequest {
  id: string;
  originalQuery: string;
  attempt: number;           // 1..3
  transformedQueries: TransformedQuery[];
  retrievedDocs: RetrievedDoc[];
  rankedDocs: RetrievedDoc[];
  response?: string;
  cragScore?: number;
  cragJournal: CragJournalEntry[];
}
```

## 7. Non-functional requirements
- Max 3 total generation attempts per request (hard cap, enforced by the
  pipeline job, not just by convention).
- All LLM/DB provider access goes through the interfaces in §4.3/§4.4/§4.7 —
  no direct vendor SDK calls from route handlers or UI code.
- Guardrail checks are mandatory on both ends of the pipeline and cannot be
  disabled via config/env in production.
- Secrets via environment variables only (see `AGENTS.md` §4).
