# Specs — Advanced RAG System

Technical specification for the retrieval-augmented generation system this
app implements. Pair this with `planning.md` (phased build order) and
`AGENTS.md` (how the agent must work while building it).

## 0. Deployment target & credential model

### 0.1 Current: Vercel, env-held credentials, no BYOK ✅ implemented

The app is deployed on Vercel using the same single env-held API key per
provider it's used since local dev (`OPENAI_API_KEY`, `QDRANT_API_KEY`,
`QDRANT_DB`, `REDIS_URL`) — no BYOK, no per-request credential threading.
`npm run build` succeeds completely unmodified for this; the only real
obstacle was the one §0.2 already flagged as unresolved:

- **No long-running worker process on Vercel** — solved for free rather
  than by adding a paid always-on host or rewriting the queue away. A
  GitHub Actions workflow (`.github/workflows/drain-ingestion-queue.yml`,
  cron `*/5 * * * *`) runs `npm run worker:drain` (`workers/drain.ts`) on a
  schedule instead of running `workers/index.ts` forever: it processes
  whatever's currently queued across `ingest-source`/`ingest-chunk`, then
  exits once both queues go idle for ~15s (with a 4-minute hard cap as a
  safety net). Same processor functions as the real worker — this is a
  one-shot invocation of the same logic, not a rewrite. Verified locally
  against the real queue: a job left queued while no worker was running
  was picked up, processed to `ready`, and the script exited cleanly, both
  for the "something queued" and "nothing queued" cases.
- Tradeoff accepted: ingestion latency goes from a few seconds to roughly
  5-10 minutes (GitHub Actions' schedule trigger has a 5-minute floor and
  isn't perfectly precise even at that). Acceptable for this project's
  current scale; a real always-on worker host remains a straightforward
  upgrade path (point `npm run worker` at the same env vars, drop the
  workflow) if that latency stops being acceptable.

### 0.2 Further future direction: full BYOK (not current)

Everything below this point is where the project *could* go beyond §0.1,
not a constraint on the current build — §0.1 is what's actually deployed.

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
  structure assumes a standalone long-running process). §0.1's GitHub
  Actions drain-workflow solves this for the *current* single-operator,
  shared-credential deployment, but doesn't generalize to full BYOK — there
  each visitor has their own Redis/Qdrant, so a single scheduled workflow
  polling one set of credentials no longer makes sense. Either the pipeline
  stays orchestrated inline within the request/response cycle, or a
  serverless-compatible job runner (e.g. Vercel-native background
  functions, Inngest, Trigger.dev) replaces BullMQ. Still unresolved for
  the full-BYOK case — see `planning.md`'s open decisions.
- ~~Ingestion accepts URLs, not just file upload~~ — resolved independent
  of BYOK, back in Phase 4 (§2): YouTube and web page URL ingestion already
  work today, no per-visitor credential model required for that part.

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

**Two click-through entry points, one preview.** Beyond the inline `[N]`
citation chips in the answer text (§4.6), each response also shows a
deduped "sources used" chip row underneath it (one per distinct source
document, not per cited chunk) — both open this exact same preview
component with the same `ResourcePreviewTarget`, just via different
trigger UI.

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
as `lib/llm/providers/openai.ts` today. (Future direction per §0.2: BYOK,
credentials threaded per-request instead — not yet.)

Adapters run in parallel per routed query, fanned out in-process via
`Promise.allSettled` (`lib/retrieval/retrieve.ts`) — **not** BullMQ; see §5
for why. Each `RetrievedDoc` carries `{ id, content, source, sourceScore,
metadata }`.

### 4.5 Ranking (`lib/retrieval/ranker.ts`)
Merges candidate docs across sources/queries and produces a single ranked
list:
- Normalize per-source scores onto a common scale. **Not real logic yet** —
  only the vector adapter exists, so every candidate already shares one
  metric; becomes real once a second adapter with a different scoring scale
  exists.
- De-duplicate exact-id duplicates (the same chunk retrieved via more than
  one transformed query), keeping the highest-scoring occurrence. Fuzzy
  near-duplicate detection across *different* chunks is deferred until
  there's evidence it's needed.
- Re-rank against the *original* user query, not the transformed queries —
  implemented as embedding cosine similarity (re-embed the original query,
  compare against each candidate's own stored vector) rather than a
  cross-encoder or LLM-based re-ranker, since it's cheap, fast, and reuses
  infra already in place; revisit if relevance quality turns out to need
  more than that.
- Truncate to top-K (8) for context assembly, plus a running character
  budget (~6000 chars, same style as the ingestion chunker's budget) so a
  handful of long chunks can't crowd out the rest.

Fanned out as a plain function call, not `queue:ranking` — see §5.

### 4.6 Generation (`lib/generation/generate.ts`)
Main LLM call: original user query + top-K ranked context → response.
Uses the "main" model tier (see §4.7), not the mini model. Context passages
are numbered `[1]..[N]` in the prompt (the same order ranking produced),
and the model is instructed to cite inline in that form.

Citation tracking deviates from "the model self-reports which docs
contributed": `app/api/chat/route.ts` builds a citation lookup table for
every ranked doc rather than trusting a separate structured list from the
model (which could omit or hallucinate entries) — the chat UI only turns a
`[N]` it finds in the model's own answer text into a clickable link, so
which citations end up visible is driven by what the model actually wrote,
not by a second self-reported field. Clicking one opens §3.3's preview,
scrolled to and highlighting the cited chunk.

Not queued (`queue:generation` skipped) — same reasoning as §4.4/§4.5,
see §5.

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
rest of the repo. (Future direction per §0.2: per-request BYOK — not yet.)

### 4.8 CRAG evaluation (`lib/crag/evaluate.ts`)
Mini model (`gpt-4o-mini`) scores the generated response against `{ original
query, context used, response }` on three 0-1 dimensions — relevance,
groundedness/faithfulness to context, completeness — averaged into one
score, plus a one-sentence rationale.
- Threshold **0.6**, max attempts **3** (`lib/crag/orchestrate.ts`).
- Fails open (score 1, i.e. treated as passing) on an unparseable mini-model
  response — unlike the guardrails, this is a quality signal, not a
  security control, so a parse error shouldn't force a retry over
  infrastructure noise rather than an actual quality problem.
- On failing score: extract keywords (`lib/crag/keywords.ts`, also
  fail-open — falls back to the original query on a parse error) from the
  response and the evaluator's rationale, and re-enter the Route Adaptor
  with a fresh retrieval seeded by *only* those keywords (a new
  `"keyword-feedback"` `TransformedQuery` type) — replacing the original
  transformed queries for the retry, not adding to them, since they already
  had their shot.
- After 3 failed attempts: return the best-scoring response of the three
  (not necessarily the last one), with a `lowConfidence` flag. Output
  Guardrails (§4.10) still runs on it regardless; the flag reaches the
  client alongside whatever the guardrail did to the content, and the chat
  UI shows a small low-confidence notice rather than hiding the issue.

### 4.9 CRAG journal (`lib/crag/journal.ts`)
On every failed attempt, the CRAG mini model records a structured entry:

```ts
interface CragJournalEntry {
  attempt: number;
  score: number;
  whatWentWrong: string;   // mini-model diagnosis
  fixApplied: string;      // e.g. "re-ran retrieval with keyword feedback: [...]"
  keywordsUsed: string[];
}
```

**Not attached to a BullMQ job** — CRAG isn't queued (see §5), so the
journal is just part of `runCragLoop`'s in-memory return value for the
request. Surfaced in the UI's pipeline-trace panel (score + attempt count),
not in the chat message itself — matching "not shown to the end user by
default." The one exception is the `lowConfidence` flag specifically, which
*does* reach the chat UI (per §4.8), since a best-effort answer the pipeline
itself isn't confident in is exactly what a user needs to know, unlike the
diagnostic detail in the rest of the journal.

### 4.10 Output Guardrails (`lib/guardrails/output.ts`)
Runs on the final response before it's returned, regardless of which attempt
produced it. Three layers, in order:
1. **Deterministic secret redaction** — credential-shaped patterns (API
   keys, AWS keys, PEM private key blocks, connection strings with embedded
   creds, generic `key: value` assignments) plus an exact-match check
   against this app's own configured secrets. Applied unconditionally,
   before anything else.
2. **Deterministic refusal-trigger rules** — the *assistant* claiming an
   identity/authority it doesn't have, or granting/implying unauthorized
   access. (Distinct from `lib/guardrails/input.ts`'s rules, which catch
   the *user* asking for these things.)
3. **Mini-LLM classifier**, defense in depth — explicitly instructed that
   quoting the user's own indexed documents (including personal details
   like names, emails, phone numbers) is normal and expected; only
   impersonation, unauthorized access, and credential leakage get rejected.
   Fails **closed** (full refusal) on an unreachable/unparseable response —
   unlike CRAG evaluation (§4.8), this one is security-critical.

Result shape: `{ content, action: "none" | "redacted" | "refused", reason?
}`. Secret matches get precisely redacted in place (strip/replace) since
they're a clean excisable span; impersonation/unauthorized-access matches
fall back to a full safe refusal instead, since there's no clean substring
to remove without leaving a broken sentence. Citations are only omitted
from the API response when `action === "refused"` — a redacted response's
citations still point at real, legitimate content.

Not queued (`queue:output-guardrails` skipped) — same reasoning as every
other query-time stage in §5.

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
- **Ranking (§4.5): same reasoning, not queued.** Also has to complete
  synchronously before generation runs, within the same request. A single
  function call in `lib/retrieval/ranker.ts` instead of the `queue:ranking`
  BullMQ flow (depends on all retrieval jobs) this spec originally called
  for — there are no separate retrieval jobs to depend on once retrieval
  itself isn't queued either.
- **Generation (§4.6): same reasoning, not queued.** The chat route awaits
  the main-tier LLM call directly and returns its response — no
  fire-and-forget, no `queue:generation` job.
- **CRAG evaluation + retry loop (§4.8): same reasoning, not queued.** The
  whole retrieve → rank → generate → evaluate cycle, retries included, runs
  as a single in-process loop (`lib/crag/orchestrate.ts`) inside the chat
  route's request/response cycle — there's no separate "follow-up retrieval
  round" job to enqueue once none of retrieval/ranking/generation are
  queued individually either.
- **Output guardrails (§4.10): same reasoning, not queued.** The final,
  terminal step of the same synchronous request — no separate job needed
  once nothing upstream of it is queued either.
- **Ingestion (§2.4): the actual right fit.** Long-running (can exceed a
  request/serverless timeout entirely), doesn't need to block the visitor,
  benefits genuinely from per-chunk retries and rate-limiting on embedding
  calls. This is where BullMQ earns its complexity.

Queues:
- `queue:ingestion` — implemented as `ingest-source` (parent: load + chunk)
  and `ingest-chunk` (child: embed + upsert one chunk, retried
  independently), fanned out via BullMQ's manual parent/children pattern
  (§2.4).

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

## 8. Authentication & multi-tenancy

Every page and API route requires a signed-in [Clerk](https://clerk.com)
session — `proxy.ts` establishes Clerk's auth context globally, and each
page/route protects itself individually (`await auth.protect()` for pages,
a manual `userId` check + 401 for API routes), not a centralized
middleware-matcher, since that pattern is deprecated in the installed Clerk
version. See `planning.md`'s "Multi-tenancy & admin" section for the full,
actively-being-built breakdown: per-user data isolation across Qdrant/Redis
(§2/§6's `Resource`/chunk shapes gain a `userId`), resource deletion, a
10-free-chat cap per user, and an admin dashboard that can view usage and
lift the cap for a user. No billing/payment system — "upgrading" a user
means removing their chat cap, nothing else.

Security note that shaped this: an admin account must never be created by
hardcoding a password into code or config. Clerk owns authentication
entirely; the admin signs up through Clerk's own form like any other user,
and the app recognizes their email via an allowlist.
