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

## 1. High-level pipeline

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

## 2. Components

### 2.1 Input Guardrails (`lib/guardrails/input.ts`)
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

### 2.2 Query Understanding — mini model (`lib/query-transform/`)
Given the (guardrail-passed) query, produce a bounded set of transformed
queries, run as parallel BullMQ jobs:
- `stepback.ts` — generates a more general/abstracted version of the query.
- `rewrite.ts` — clarifies ambiguity, expands acronyms, normalizes phrasing.
- `subquestions.ts` — decomposes multi-part questions into independent
  sub-questions (capped, e.g. max 5).
- `hyde.ts` — generates a hypothetical answer document, embedded and used as
  a retrieval query vector.

All four run off a small/cheap model (see §2.7 Multi-LLM). Outputs are
independent — no step depends on another's output.

### 2.3 Route Adaptor (`lib/retrieval/route-adaptor.ts`)
Classifies each transformed query and selects which data source(s) to query:
- Vector DB — semantic/unstructured content.
- Keyword/full-text store — exact-match, code, IDs, names.
- SQL DB — structured/tabular/aggregatable data.
- Graph DB — relationship/multi-hop queries.

Routing decision is a mini-LLM classification (+ lightweight heuristics) over
the query, returning one or more target adapters. Also the re-entry point for
CRAG's keyword-feedback retry loop.

### 2.4 Multi-DB Retrieval (`lib/retrieval/adapters/`)
One adapter per data source implementing a common interface:

```ts
interface RetrievalAdapter {
  name: string;
  retrieve(query: TransformedQuery, opts: RetrieveOptions): Promise<RetrievedDoc[]>;
}
```

For now, adapters read their DB credentials from `process.env`, same pattern
as `lib/llm/providers/openai.ts` today. (Future direction per §0: BYOK,
credentials threaded per-request instead — not yet.)

Adapters run in parallel per routed query. Each `RetrievedDoc` carries
`{ id, content, source, sourceScore, metadata }`.

### 2.5 Ranking (`lib/retrieval/ranker.ts`)
Merges candidate docs across sources/queries and produces a single ranked
list:
- Normalize per-source scores onto a common scale.
- De-duplicate near-identical documents.
- Re-rank (cross-encoder or LLM-based re-ranker) against the *original* user
  query, not the transformed queries.
- Truncate to top-K for context assembly (K configurable, token-budget
  aware).

### 2.6 Generation (`lib/generation/generate.ts`)
Main LLM call: original user query + top-K ranked context → response.
Uses the "main" model tier (see §2.7), not the mini model.

### 2.7 Multi-LLM routing (`lib/llm/`)
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

### 2.8 CRAG evaluation (`lib/crag/evaluate.ts`)
Mini model scores the generated response against `{ original query, context
used, response }` on a defined rubric (relevance, groundedness/faithfulness
to context, completeness). Returns a numeric score + rationale.
- Threshold and max attempts are configurable; default **max 3 attempts**.
- On failing score: extract keywords (`lib/crag/keywords.ts`) from the
  response/context to re-seed retrieval, and re-enter the Route Adaptor.
- After 3 failed attempts: return the best-scoring response of the three,
  through Output Guardrails, with a low-confidence flag rather than blocking
  the user entirely.

### 2.9 CRAG journal (`lib/crag/journal.ts`)
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

### 2.10 Output Guardrails (`lib/guardrails/output.ts`)
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

## 3. Orchestration — BullMQ

Each pipeline stage that talks to an LLM or an external DB is a BullMQ job so
the pipeline is retryable, observable, and horizontally scalable:
- `queue:query-transform` — fan-out job per transform (stepback/rewrite/
  subquestions/HyDE).
- `queue:retrieval` — one job per routed (query, adapter) pair.
- `queue:ranking` — single job, depends on all retrieval jobs for that
  request.
- `queue:generation` — single job.
- `queue:crag-eval` — single job; enqueues a follow-up retrieval round on
  failure (up to the attempt cap) instead of looping in-process.
- `queue:output-guardrails` — single job, terminal.

A parent "pipeline" job (or BullMQ flow) tracks overall request state and
attempt count. Redis is the queue backend; connection config lives in
`lib/queue/connection.ts`. Workers run as a standalone process (`workers/`),
not inside Next.js request handlers.

## 4. Data model (indicative)

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
  metadata: Record<string, unknown>;
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

## 5. Non-functional requirements
- Max 3 total generation attempts per request (hard cap, enforced by the
  pipeline job, not just by convention).
- All LLM/DB provider access goes through the interfaces in §2.3/§2.4/§2.7 —
  no direct vendor SDK calls from route handlers or UI code.
- Guardrail checks are mandatory on both ends of the pipeline and cannot be
  disabled via config/env in production.
- Secrets via environment variables only (see `AGENTS.md` §4).
