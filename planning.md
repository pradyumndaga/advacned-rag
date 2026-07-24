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
    # retrieval/ranking/generation/crag-eval/output-guardrails have no
    # processor files — none of them turned out to benefit from BullMQ
    # (specs.md §5), so they're plain modules called directly from
    # app/api/chat/route.ts instead: lib/retrieval/, lib/generation/,
    # lib/crag/, lib/guardrails/.
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

### Word / CSV / Excel sources ✅ implemented
Added later, per explicit request — three more `{ kind: "text" }` loaders,
reusing the existing token-budget chunker with no new chunking logic:
- `docx.ts` — via `mammoth`'s `extractRawText`, same shape as `pdf.ts`.
- `csv.ts` / `xlsx.ts` — share a new `spreadsheet.ts` core (`rowsToText`,
  unit-tested), the same relationship `srt.ts`/`vtt.ts` have to `cues.ts`.
  Rather than dumping a raw grid, each row becomes one "Header: value, ..."
  sentence — reads naturally to an embedder/LLM and chunks well with the
  existing budget-based chunker. `xlsx.ts` labels each sheet
  (`Sheet: <name>`) so a multi-sheet workbook's sections stay distinguishable
  after chunking. `csv.ts` uses `csv-parse` (handles quoted/embedded
  delimiters correctly, unlike a naive split); `xlsx.ts` uses `exceljs` —
  note its bundled types predate Buffer's generic-over-ArrayBufferLike form,
  needing a `Parameters<...>` + `unknown` cast at the `workbook.xlsx.load`
  call site (a real typings mismatch, not a behavioral one).
- `app/api/ingest/route.ts`: `docx` is its own file kind; `csv`/`xlsx` share
  one UI kind (`spreadsheet`, matching how `subtitles` already covers both
  `srt`/`vtt`) with `inferSpreadsheetType()` picking the real `SourceType`
  from the extension.
- `components/upload/ingest-panel.tsx`: two new tiles, "Word" and
  "Spreadsheet". `components/resources/source-icon.tsx` gained
  `SOURCE_ICONS`/`SOURCE_LABELS` entries for `docx`/`csv`/`xlsx` (`FileType2`,
  `FileSpreadsheet` ×2 — "Word", "CSV", "Excel").
- No dedicated rich preview (unlike PDF's Blob storage or Markdown's
  `rawText`) — these fall back to the existing chunk-reconstruction preview,
  same as SRT/VTT/web page. Matches what was actually asked for; richer
  preview can be added later if wanted.
- Security note: `exceljs` pulls in an old `uuid` transitively with a
  moderate advisory (missing bounds check, but only reachable if the
  *caller* passes an explicit `buf` argument to `uuid`'s v3/v5/v6 — exceljs's
  internal usage doesn't do this). No non-major fix exists upstream yet;
  accepted as the best-maintained option for `.xlsx` parsing, flagged to the
  user rather than silently absorbed.
- Verified live end-to-end: uploaded a real `.docx`, `.csv`, and `.xlsx`,
  all reached `ready`; asked a question spanning facts unique to the CSV and
  the XLSX in one query — both correctly retrieved and cited (confirmed via
  the citation preview, which shows the exact `rowsToText` formatting).
  Added `lib/ingestion/loaders/spreadsheet.test.ts` for the pure
  `rowsToText` helper (multi-row formatting, blank-row skipping, a missing
  trailing cell, empty input).

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

### Real file/video preview ✅ implemented
Opening a resource directly from the panel (no `chunkId`, i.e. not a citation
click-through) now shows the actual original content instead of always
reconstructing it from stored chunks — split by source type since each one
needed a different amount of new infrastructure:

- **YouTube**: zero new storage — the original URL was already sitting in
  `Resource.label` (set at ingest time in `app/api/ingest/route.ts`, just
  never used for anything). `extractYoutubeVideoId()` in
  `components/resources/resource-preview.tsx` parses the video ID out of
  watch/shorts/live/youtu.be URL forms and renders a real
  `youtube.com/embed/<id>` iframe.
- **Webpage**: also zero storage — most sites block being iframed
  (`X-Frame-Options`), so this renders an "Open original page" button
  (`resource.label`, `target="_blank"`) instead of attempting an embed that
  would silently fail on most real sites.
- **Markdown**: `workers/processors/ingest-source.processor.ts` now writes
  the full original text to a new `Resource.rawText` field right after the
  loader runs (`sourceType === "markdown"` only — PDF/webpage's extracted
  text isn't the "original" in the same sense). Cheap to keep since nothing
  is lost by storing it verbatim, unlike PDF's binary. Preview renders it as
  one readable block instead of fragmented chunks.
- **PDF**: the one case needing real blob storage, since a faithful preview
  needs the actual binary, not extracted text. Uses **Vercel Blob**
  (private store, created via `npx vercel blob create-store <name>
  --access private --yes`, which auto-provisions `BLOB_READ_WRITE_TOKEN`
  across all three Vercel environments). `lib/storage/blob.ts` wraps
  `put`/`get`/`del`. `app/api/ingest/route.ts` uploads the PDF bytes to
  Blob at ingest time (before queuing — the route already has the raw
  buffer) and stores the resulting URL as `Resource.fileUrl`. Because the
  store is private, the blob is never reachable by a bare URL — every read
  goes through the new `GET /api/resources/[id]/file` route, which applies
  the same ownership check as every other resource endpoint before
  streaming `blob.stream` through as the response body. `DELETE
  /api/resources/[id]` now also deletes the blob (`deletePdfBlob`)
  alongside its existing Redis+Qdrant cleanup.
- A citation click (`target.chunkId` set) falls back to the existing
  chunk-highlight view for every kind **except YouTube** — "jump to this
  exact passage" is better served there by seeking the real video, so
  YouTube always uses its embed regardless of entry point (panel click or
  citation click).
- **YouTube citation seek ✅ implemented.** When a citation's cited chunk
  has a `startTime`, the embed src becomes
  `youtube.com/embed/<id>?start=<seconds>` (rounded down), so clicking a
  citation on a YouTube source jumps the actual video to that moment
  instead of just showing transcript text. The cited chunk's text is also
  shown as a highlighted caption underneath the player (same visual
  treatment as the chunk-highlight view) so the exact wording that was
  cited is still visible. The iframe is keyed on the start time so
  re-clicking a different citation while the dialog is already open
  reliably reloads the player at the new position instead of silently
  no-opping on an unchanged `src`.
- Both citation entry points — the inline `[N]` chip in the answer text and
  the deduped "sources used" chip row underneath — call the same
  `onCiteClick` handler, so this applies identically regardless of which
  one was clicked.
- Verified live: YouTube embed rendered a real thumbnail/player; webpage
  showed the "Open original page" button; a test Markdown file rendered as
  one full block via `rawText`; a test PDF rendered in the browser's native
  PDF viewer via the authenticated Blob-streaming route; deleting the PDF
  resource was confirmed (via `vercel blob list`) to actually remove the
  blob from the store, not just hide it client-side. For the citation-seek
  behavior specifically: asked a real question against an already-indexed
  YouTube resource, clicked the resulting "sources used" chip, and
  confirmed via `document.querySelector('iframe').src` that the rendered
  embed URL was `youtube.com/embed/<id>?start=1`, matching the cited
  chunk's actual `startTime`.

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

## Phase 8 — Generation ✅ implemented
- `lib/generation/generate.ts`: `generateAnswer(query, rankedDocs)` — main
  tier (`gpt-4o`) call, numbers the ranked context passages `[1]..[N]` in
  the prompt, instructs the model to cite inline in that form. Falls back
  to a "no matching context found" system prompt when ranking produced
  nothing.
- **Citation tracking, simpler than originally planned**: rather than having
  the model self-report which `RetrievedDoc.id`s it used (fragile — the
  model could omit or hallucinate entries in a separate structured list),
  `app/api/chat/route.ts` builds a citation lookup table for *every* ranked
  doc, numbered the same way they were shown to the model. The frontend
  (`components/chat/chat-panel.tsx`) only turns a `[N]` it finds in the
  model's own answer text into a clickable chip — so which citations end up
  visible/clickable is driven entirely by what the model actually
  referenced, with no separate self-reporting step to trust.
- Citation click-through wired to `components/resources/resource-preview.tsx`
  (Phase 5) exactly as planned — clicking a `[N]` chip opens that chunk's
  source, scrolled to and highlighting the cited chunk. No second preview
  surface built.
- **Not queued** (`queue:generation` skipped) — same reasoning as
  retrieval/ranking: the chat route awaits it synchronously either way.
- Wired into `app/api/chat/route.ts`; the `generation` trace line moved out
  of the simulated stages into the real block (`"gpt-4o response, N citable
  chunks"`). Verified live: a real query against the indexed PDF/SRT/MD/
  webpage content produced a grounded, correctly-cited answer, and clicking
  its citation chip opened the right resource at the right chunk.
- Known current limitation, not a bug: retrieval has no relevance-score
  threshold, so a query wildly outside the indexed content still gets
  *some* context handed to generation (whatever's nearest by cosine
  similarity, however irrelevant) rather than "no results." CRAG evaluation
  (Phase 9) is the mechanism meant to catch exactly this — a generated
  answer that isn't actually grounded in relevant context — so it's left
  unaddressed here rather than bolted on ahead of that phase.

## Phase 9 — CRAG self-correction loop ✅ implemented
- `lib/crag/evaluate.ts`: mini-model (`gpt-4o-mini`) scores `{ relevance,
  groundedness, completeness }` each 0-1 against `{ query, context,
  response }`; overall score is their average. Fails open (score 1) on an
  unparseable mini-model response — this is a quality signal, not a
  security control, so a parse hiccup shouldn't trigger a pointless retry
  loop over noise.
- `lib/crag/keywords.ts`: mini-model keyword extraction (up to 5) from the
  failing response + the evaluator's rationale for *why* it failed. Fails
  open to `[originalQuery]` on a parse error, so a retry round still has
  something to search with.
- `lib/crag/journal.ts`: `CragJournalEntry` type only — no logic beyond the
  shape specs.md §4.9 defines.
- `lib/crag/orchestrate.ts` (**new module, not explicitly named in specs.md
  but needed to hold the loop itself**): `runCragLoop(query,
  transformedQueries)` runs retrieve → rank → generate → evaluate, capped
  at 3 attempts. On a failing score (< 0.6), re-enters via a fresh
  `retrieveForQueries` call seeded with *only* the extracted keywords (a
  new `"keyword-feedback"` `TransformedQuery` type, added to the union) —
  replacing the original transformed queries for the retry rather than
  re-running all of them again, since they already had their shot. Tracks
  the best-scoring attempt across all tries; returns it with a
  `lowConfidence` flag if even the best attempt never cleared the
  threshold, per specs.md §4.8's "best-effort response + low-confidence
  notice" behavior.
- Wired into `app/api/chat/route.ts` (replacing the direct retrieve/rank/
  generate calls) and surfaced as a real `crag-eval` trace line
  (`"score X.XX/1.00, N attempts"`, plus "— low confidence" when
  applicable). `lowConfidence` also reaches the chat UI, which shows a
  small inline warning under a low-confidence answer rather than hiding
  the issue.
- Verified live end-to-end, both paths: a normal query passed on attempt 1
  (score 1.00); a temporary threshold override (reverted after testing)
  confirmed the full retry path — 3 real attempts, real keyword extraction
  each round, a populated journal, and the low-confidence flag set exactly
  when expected.

### Sources-used list (UI addition, requested alongside this phase)
Beyond the Phase 8 inline `[N]` citation chips, each assistant response now
also shows a small row of source chips *underneath* it — deduped to one
entry per source document (not one per cited chunk), built from whichever
citation numbers actually appear in the model's answer text. Clicking one
opens the same Phase 5 resource-preview component as the inline citations
do, highlighting the first chunk from that source the response cited.
Reuses a new shared `SOURCE_ICONS` map (`components/resources/
source-icon.tsx`) extracted out of `resource-panel.tsx` rather than
duplicating the source-type → icon mapping in both places.

## Phase 10 — Output guardrails ✅ implemented
- `lib/guardrails/classifier.ts`: extracted `parseClassifierResponse` shared
  by both `input.ts` and `output.ts` (was duplicated identically in both —
  same real-duplication-only rationale as the earlier `SOURCE_ICONS`
  extraction).
- `lib/guardrails/output.ts` — three layers, applied in order:
  1. **Deterministic secret redaction** — regex patterns for credential-
     shaped strings (OpenAI-style keys, AWS keys, PEM private key blocks,
     connection strings with embedded creds, generic `key: value` /
     `password: value` patterns) plus an exact-match check against this
     app's own configured secrets (`OPENAI_API_KEY`, `QDRANT_API_KEY`,
     `REDIS_URL`). Matches generically, not just this app's own secrets —
     a credential could in principle arrive via an ingested document.
     Always applied first, regardless of what happens next.
  2. **Deterministic refusal-trigger rules** — phrase patterns for the
     *assistant* claiming an identity/authority ("I am the administrator")
     or granting access ("I'll bypass..."). Distinct from `input.ts`'s
     rules, which catch the *user* asking for these things, not the
     *assistant* producing them. Falls back to a full safe-refusal message
     rather than redacting a substring, since these can't be cleanly
     excised without leaving a broken sentence.
  3. **Mini-LLM classifier**, defense in depth, explicitly instructed that
     quoting the user's own indexed document content — including personal
     details like names, emails, phone numbers — is normal and must be
     accepted; only impersonation/unauthorized-access/credential-leakage
     get rejected. Fails closed (full refusal) on an unreachable or
     unparseable classifier response, same as input guardrails, since this
     one *is* security-critical.
- Returns `{ content, action: "none" | "redacted" | "refused", reason? }` —
  the API only skips building citations when `action === "refused"` (a
  refusal message has nothing for a `[N]` marker to point at); a redacted
  response keeps its citations intact.
- **Not queued** (no `queue:output-guardrails`) — same reasoning as every
  other query-time stage: the chat route awaits it directly.
- Wired into `app/api/chat/route.ts` as the true final step (after CRAG);
  surfaced as a real `output-guardrails` trace line.
- Verified via three isolated cases (a small standalone script, since
  reliably getting the LLM to naturally emit a real secret through the full
  pipeline isn't practical to force): a benign query passed untouched
  (`action: "none"`); a secret-key-shaped string, framed as "here's your
  key: ...", was refused (both the regex *and* the classifier independently
  flagged it — the classifier catches the surrounding "sharing a
  credential" framing even after the raw key string is redacted); the same
  key string in a benign "example config value" framing was precisely
  redacted (`action: "redacted"`) without a full refusal; and real PII from
  the user's own uploaded document (name/phone/email) correctly passed
  through untouched, confirming the guardrail doesn't defeat the app's own
  purpose.

## Phase 11 — UI polish ✅ implemented
- Query input + result view (`app/page.tsx`, `components/chat/`) — already
  built across earlier phases; this phase was about final layout balance,
  not new surfaces.
- `components/pipeline-trace/` already exists and shows every real stage
  live (input-guardrails through output-guardrails) — kept visible rather
  than hidden, since watching the real pipeline run is central to this
  project's learning goal, even though `specs.md` §4.9 frames it as a
  dev-only surface "not shown to normal end users by default."
- **Layout rebalanced around chat as the primary surface**, per explicit
  request: the upload row (`components/upload/ingest-panel.tsx`) went from
  a two-row descriptive bento-grid (~300px tall) to a single-row grid of
  compact drop-zone cards (dashed border, icon, one-line hint, ~90px tall)
  — first tried an even more compact pill-toolbar with no dashed border,
  but that lost the drag-and-drop affordance entirely and was reverted in
  favor of this middle ground. The three-column grid below
  (Resources | Chat | pipeline-trace) changed from equal-width columns to
  `[220px_minmax(0,2fr)_minmax(0,1fr)]` so chat gets roughly double the
  trace panel's width, with the height reclaimed from the upload row
  flowing to chat/resources/trace via the existing `flex-1` container.
- **Chat given the full content height ✅ implemented**, per a later explicit
  request that chat — "the main component" — shouldn't just get more width,
  it should get the full height too. Restructured from a 3-column grid (all
  three panels sharing one row's height) to a 2-column flex layout: a
  fixed-width (`300px`) left sidebar stacking ingest, resources, and
  pipeline-trace vertically (`components/home/home-client.tsx`), and chat
  alone in the remaining flexible column, so it spans the full height of
  the content area uninterrupted by neighbors instead of matching their
  height. `IngestPanel`'s tile grid dropped its `sm:grid-cols-5` viewport
  breakpoint (`sm:` refers to viewport width, not container width — inside
  a permanently-300px sidebar it would have kept trying to force 5 columns
  into a container that can't fit them) in favor of a fixed 2-column grid
  that actually fits the sidebar.
- **Resource type made explicit ✅ implemented**, per explicit feedback that
  the source-type icon alone (14px, `SOURCE_ICONS`) was easy to miss.
  `components/resources/source-icon.tsx` gained `SOURCE_LABELS` (a
  `SourceType → display string` map, e.g. `youtube → "YouTube"`,
  `webpage → "Web page"`), rendered as a small outline `Badge` on each
  resource row in `resource-panel.tsx`, between the truncated label and the
  status dot.
- **User chat-bubble width bug ✅ fixed**, found immediately after the
  height rearrangement above: user messages (right-aligned via `items-end`)
  were rendering at a tiny, content-unrelated width — e.g. "Who is Roger?"
  wrapped to two lines despite acres of free space beside it. Root cause:
  `max-w-[75%]` on the bubble resolved against its immediate row div, which
  itself is shrink-to-fit (not stretched, since `items-end` overrides the
  flex column's default `stretch`) — a percentage against an
  indeterminate/shrink-to-fit container is a known CSS trap, and it
  collapsed to roughly "avatar + gap" with the bubble's own content
  contributing nothing to the calculation (confirmed live: row computed to
  153px, bubble to exactly 75% of that — 115px — regardless of text
  length). Assistant bubbles never showed this because their row isn't
  reversed/end-aligned, so it stretches to the full width and the
  percentage resolves against something real. Fixed by swapping the
  percentage for a fixed `max-w-[32rem]`, which sidesteps the
  indeterminate-container case entirely — verified live, exact same message
  now renders on one line at a sensible width.

## Phase 12 — Testing ✅ implemented
Added after Phases 0–11 were already working end-to-end for a real query,
per `AGENTS.md` §2. **Vitest** (`vitest.config.ts`, `@/*` alias matching
`tsconfig.json`; `npm test` / `npm run test:watch`) — chosen since it's
ESM-native with minimal config, fitting a codebase already using `tsx`
elsewhere. 65 tests across 11 files, co-located as `*.test.ts` next to the
code they cover:

- `lib/guardrails/rules.test.ts` — every violation category, case
  insensitivity, multi-category matches, ordinary queries pass clean.
- `lib/guardrails/classifier.test.ts` — `parseClassifierResponse`: valid
  accept/reject, missing `reason`, malformed JSON, wrong shape.
- `lib/guardrails/input.test.ts` / `output.test.ts` — `openAIChat` mocked
  via `vi.mock`. Input: rule-block skips the classifier call entirely,
  classifier accept/reject, fail-closed on classifier error/unparseable
  response. Output: normal passthrough, secret-pattern redaction, exact-match
  redaction of this app's own configured secret (using a fake secret value
  that deliberately doesn't match any generic pattern, to isolate that path
  specifically), refusal-trigger phrases skip the classifier, classifier
  reject/error/unparseable-response all fail closed, and — the one that
  matters most — real PII from the user's own document is confirmed to
  pass through untouched.
- `lib/ingestion/loaders/cues.test.ts` — SRT and VTT parsing, multi-line
  cue joining, tag stripping, NOTE-block/malformed-timestamp/empty-text
  skip cases (fail-open), empty input.
- `lib/ingestion/chunkers/token-budget.test.ts` /
  `time-window.test.ts` — short-text passthrough, whitespace collapsing,
  multi-chunk splitting with verified overlap, budget-respecting truncation;
  time-window merging within/across the ~45s boundary, real timestamp
  preservation, trailing partial window flush.
- `lib/retrieval/route-adaptor.test.ts` — trivial today (always `["vector"]`
  for every `TransformedQuery` type) but still covered, since that's the
  contract the rest of the pipeline depends on.
- `lib/retrieval/ranker.test.ts` — `openAIEmbed` mocked. De-dup keeps the
  highest-scoring occurrence, re-rank score reflects similarity to the
  *original* query (not the stale retrieval score — verified with a doc
  that has a high retrieval score but a low true relevance and vice versa),
  internal `vector` field stripped from output metadata, top-K truncation,
  character-budget truncation.
- `lib/crag/orchestrate.test.ts` — retrieval/ranking/generation/evaluation
  all mocked so scores are fully controllable. Covers: single-attempt pass
  (no retry, keyword extraction never called), retry after a failing
  attempt with the second `retrieveForQueries` call verified to be seeded
  with *only* the keyword-feedback query, the 3-attempt cap with keyword
  extraction correctly skipped on the final attempt, and — the trickiest
  case — that the *best-scoring* attempt is returned even when a later,
  lower-scoring attempt ran after it.
- `lib/ingestion/resource-store.test.ts` — a small in-memory fake standing
  in for `getRedisConnection()` (implementing only the exact calls
  resource-store.ts makes). Covers create/get round-trip, unknown-id
  lookups, the full `queued → processing → ready` transition, `→ failed`
  with an error message from a non-terminal prior state, and newest-first
  listing order.

All 65 tests pass; `npx tsc --noEmit` and `npx eslint` both clean across
the whole repo including the new test files.

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

## Deployment ✅ implemented (Vercel, env-held credentials, no BYOK)
See `specs.md` §0.1 for the full writeup. Summary:
- App deploys to Vercel unmodified (`npm run build` verified clean).
- `workers/drain.ts` + `.github/workflows/drain-ingestion-queue.yml`: a
  free stand-in for the always-on worker Vercel can't host — a GitHub
  Actions cron (every 5 min, the shortest reliable interval GitHub
  supports) runs the same ingestion processors once per invocation instead
  of forever, draining whatever's queued and exiting once idle. Verified
  locally against the real queue (both the "something queued" and "nothing
  queued" paths). Accepted tradeoff: ingestion latency goes from seconds to
  roughly 5-10 minutes.
- `npm run worker` (the original always-on process) still works unchanged
  for local dev, and remains a straightforward upgrade path later if a real
  always-on host is worth paying for.

## Future direction (deferred — not being built yet)
Current priority is learning/building the pipeline end-to-end; the following
is where the project may head afterward, not active scope. Captured here (and
in `specs.md` §0.2) so it isn't lost, but nothing below should block or shape
current work:
- Move to fully BYOK credentials (LLM key + vector-DB credentials) entered
  client-side and kept in `localStorage`, never server-persisted. The
  GitHub Actions drain-workflow above solves "no long-running worker" for
  the current single-operator deployment, but doesn't generalize to BYOK —
  there's no single shared Redis/Qdrant to poll once every visitor has
  their own credentials.
- `lib/llm/providers/openai.ts`'s client moving from a process-env-keyed
  singleton to a per-request client built from a visitor-supplied key.

Vector DB choice for whenever retrieval is built: **Qdrant Cloud** — REST-
native, which will matter once/if the BYOK+serverless direction above is
picked back up, but is a fine choice for local/env-key use today too.

## Multi-tenancy & admin ✅ implemented
Requested: real user accounts, per-user data isolation, resource deletion,
a 10-free-chat cap per user, and an admin dashboard that can view usage and
lift the cap for a user. Bigger than any single phase before it, so it was
broken into sub-phases (13-17), done one at a time and verified before
moving on (per explicit user preference — same rhythm as Phases 0-12). All
five sub-phases are now implemented and verified.

**"Upgrade" scope, confirmed with the user**: no billing/payment system —
"upgrading" a user means removing their 10-chat cap, nothing else.

**Security note**: an admin account must never be created by hardcoding a
password into code/config. Clerk owns authentication entirely (hashed
credentials, never touched by this app's code) — the admin signs up
through Clerk's own sign-up form like any other user, and the app
recognizes their email as admin via an allowlist. This was flagged
explicitly when the request initially arrived with a literal password in
chat, which was refused and never written anywhere.

### Phase 13 — Authentication (Clerk) ✅ implemented and verified live
- `@clerk/nextjs` installed. **Compatibility note**: this Next.js version
  renamed `middleware.ts` → `proxy.ts` (function renamed too — see
  `node_modules/next/dist/docs/.../file-conventions/proxy.md`, "the
  functionality remains the same"). `proxy.ts` exports `clerkMiddleware()`
  as the default export, which works identically to the old
  `middleware.ts` pattern since it's still just a plain
  `NextMiddleware`-compatible function underneath.
- **Route protection uses per-page/per-route checks, not middleware-based
  matching** — `createRouteMatcher` is marked `@deprecated` in this
  installed Clerk version ("Move auth checks into each page, layout, API
  route, or Server Function"), so that's what this app does instead of the
  older centralized-matcher pattern:
  - `app/page.tsx` is now a Server Component that calls `await
    auth.protect()` before rendering; the actual UI moved to
    `components/home/home-client.tsx` (Client Component, otherwise
    unchanged).
  - `app/sign-in/[[...sign-in]]/page.tsx` and `app/sign-up/[[...sign-up]]/page.tsx` —
    Clerk's prebuilt `<SignIn />`/`<SignUp />`, intentionally left
    unprotected (that's the point).
  - `app/api/chat`, `app/api/ingest`, `app/api/resources`,
    `app/api/resources/[id]` each check `const { userId } = await auth()`
    and return 401 JSON if missing, rather than using `auth.protect()`
    (which returns a bare 404 for unauthenticated API requests — less
    useful for a JSON API our own frontend consumes).
  - `proxy.ts` only establishes Clerk's auth context globally (bare
    `clerkMiddleware()`, no route matcher) — it doesn't gate anything
    itself.
- `app/layout.tsx` wrapped in `<ClerkProvider>`; `<UserButton />` added to
  the header next to the theme toggle.
- Real Clerk credentials obtained via the official Clerk CLI
  (`clerk auth login` + `clerk init --app <app-id>`), not manually copied —
  `clerk init` confirmed the hand-built integration was already exactly
  right (skipped `proxy.ts`, `layout.tsx`, and the sign-in/sign-up pages as
  "already has Clerk middleware/ClerkProvider/sign-in page"), and just
  wrote real keys into `.env.local`. Added the one thing it flagged as
  missing: `/__clerk/:path*` in `proxy.ts`'s matcher.
- **Side effect worth recording**: `clerk init` also downloaded 8 "Clerk
  skills" into the user's global `~/.agents/skills/` and symlinked them
  into `~/.claude/skills/` — outside this project's scope, not something
  that was part of the plan presented beforehand. Removed at the user's
  request after flagging it; the CLI itself prints "review skills before
  use; they run with full agent permissions," worth remembering if
  `clerk init` is ever run again.
- Verified live end-to-end: unauthenticated `/` correctly redirects to
  Clerk's real hosted sign-in page; unauthenticated `/api/chat`,
  `/api/ingest`, `/api/resources` all return 401; after signing in through
  the browser, the app renders fully with a working `<UserButton />`, and
  an authenticated `fetch('/api/resources')` from within the page returns
  200 with real data. `npx tsc --noEmit`, `npx eslint`, `clerk doctor`, and
  the full Vitest suite (65 tests) all pass.

### Phase 14 — Per-user data isolation ✅ implemented and verified
- `userId` added to `Resource` and `StoredChunk` (`lib/ingestion/types.ts`).
- Redis: resource index scoped per user — `resources:index:<userId>`
  instead of one global `resources:index` (`lib/ingestion/resource-store.ts`).
  `getResource`/`updateResource` stay unscoped by design (looked up by
  resource id alone) since they're also called from the worker process,
  which has no request/user context of its own; ownership is checked at
  the API boundary instead (`app/api/resources/[id]/route.ts`).
- Qdrant: `searchChunks` and `fetchChunksBySource` both filter on `userId`
  now, alongside the existing `sourceId` filter. Needed a second payload
  index (`lib/db/qdrant.ts`'s `ensureCollection`) for the same reason
  `sourceId` did — Qdrant Cloud rejects filtering on an unindexed field.
- `userId` threaded end-to-end: `/api/ingest` puts it on the `Resource`
  record *and* the BullMQ job data (the worker has no session to re-derive
  it from, so it has to travel as job data through
  `ingest-source.processor.ts` → `ingest-chunk.processor.ts` →
  `upsertChunk`'s payload) — and through the query-time path
  (`app/api/chat/route.ts` → `runCragLoop` → `retrieveForQueries` →
  `RetrievalAdapter.retrieve`'s now-required `opts.userId` → `searchChunks`).
  `RetrieveOptions.userId` was made required, not optional, since every
  real call site now must have one.
- `app/api/resources/[id]/route.ts` returns the same 404 for "doesn't
  exist" and "exists but belongs to someone else" — deliberately not a 403,
  so an unauthorized caller can't distinguish the two.
- **Known consequence, not a bug**: resources created before this phase
  have no `userId`, so they're invisible to everyone now — they were never
  added to any per-user Redis index (there wasn't one yet), and old Qdrant
  chunks lack the field the new filter requires. Confirmed live: the
  existing test resources from earlier phases disappeared from the panel
  post-migration. Fine for this project's current scale (all synthetic
  test data); a real backfill migration would be the fix if this mattered.
- Verified live end-to-end: uploaded a fresh document as a real signed-in
  user, confirmed the `Resource` record and the Qdrant chunk both carry the
  correct Clerk `userId`, asked a question and got a grounded, correctly
  cited answer scoped to just that document, and confirmed
  `/api/resources/[id]` 404s for a nonexistent/inaccessible id. (Genuine
  two-*different*-user isolation is covered by a Vitest test using two
  distinct fake users against the resource store, rather than a second
  live Clerk account — reasonable given the isolation logic itself is a
  straightforward filter, already exercised by real Qdrant/Redis calls
  above.)

### Phase 15 — Resource deletion ✅ implemented and verified
- `lib/db/qdrant.ts`: `deleteChunksBySource(sourceId, userId)` — filter-delete
  by both fields, same ownership-scoping as the read path.
- `lib/ingestion/resource-store.ts`: `deleteResource(id, userId)` — removes
  the `resource:<id>` key and drops it from `resources:index:<userId>`.
- `DELETE /api/resources/[id]`: same ownership check and 404-for-both
  pattern as the existing `GET` handler, then deletes Qdrant chunks before
  the Redis record.
- UI (`components/resources/resource-panel.tsx`): a trash icon, hidden
  until hover, next to each resource. Click once → row highlights red and
  the icon becomes a "Confirm?" label; click again within the same
  interaction to actually delete. Restructured each row from a single
  `<button>` into a `<div role="button">` (selection) plus a sibling
  `<button>` (delete) — a `<button>` can't contain another `<button>`.
- Verified live: uploaded a fresh resource, confirmed the first click on
  delete only shows the confirm state (resource still listed, still
  `Ready`), the second click actually removes it from the panel, and a
  direct Qdrant query for that `sourceId` afterward returns zero points —
  the vector data is genuinely gone, not just hidden client-side.
- Added a Vitest case covering `deleteResource` (record removed, dropped
  from its owner's list, unrelated resources untouched).

### Phase 16 — Chat usage cap, 10 free chats ✅ implemented and verified
- `lib/usage/chat-usage.ts`: Redis-backed counter, `FREE_CHAT_LIMIT = 10`.
  `getChatUsage(userId)` reads both `usage:chatCount:<userId>` (`GET`) and
  `usage:unlimited:<userId>` (`GET`, `"1"` = exempt). `incrementChatUsage`
  uses `INCR` for atomicity. `setUnlimited(userId, bool)` sets/deletes the
  flag key — write side is Phase 17's concern (admin dashboard), read side
  is this phase's.
- `POST /api/chat`: checks usage *before* running guardrails — if the count
  is already at/over the limit and the user isn't unlimited, returns
  `{ limitReached: true, usage }` with a 403, before spending an LLM call.
  Otherwise increments the counter first, then proceeds. Every submitted
  query counts against the cap regardless of guardrail outcome (refused,
  low-confidence, or successful) — this is deliberate: metering "uses of the
  chat interface," not "successful answers," so the cap can't be gamed by
  asking disallowed questions for free. `usage` is included in all three
  response shapes (limit-reached, refused, success).
- `GET /api/usage`: returns the current user's usage, for the initial page
  load before any message has been sent.
- UI (`components/chat/chat-panel.tsx`): header shows a "`{count}/{limit}
  chats used`" badge (hidden entirely when `unlimited`), turning red/bold at
  the limit. Input and send button disable at the limit, with the
  placeholder swapped to "Free chat limit reached — contact an admin for
  unlimited access."
  `components/home/home-client.tsx` fetches usage on mount via `GET
  /api/usage`, updates it from every `/api/chat` response's `usage` field,
  and on `limitReached` shows a clear assistant message instead of
  attempting to render pipeline-trace stages that never ran server-side.
- Verified live: sent a real chat, confirmed the badge incremented
  `0/10 → 1/10`. Set the real counter to 9 directly in Redis, sent one more
  message — succeeded and showed `10/10` in red with input/send disabled
  and the limit placeholder. Set the `unlimited` flag directly in Redis and
  reloaded — badge disappeared entirely and input re-enabled, confirming
  unlimited users bypass the cap and the UI. Cleared the test `unlimited`
  flag and reset the counter back to reflect actual messages sent.
- Added `lib/usage/chat-usage.test.ts` (fake Redis): fresh user starts at
  `0/10`/not-unlimited, counter increments and is reflected in
  `getChatUsage`, no cross-user leakage, `setUnlimited` toggles both ways.

### Phase 17 — Admin dashboard ✅ implemented and verified
- `lib/admin/is-admin.ts`: `isAdminEmail(email)` checks a comma-separated
  `ADMIN_EMAILS` env var (case-insensitive, whitespace-trimmed), entered as
  an env var and never as a hardcoded password anywhere.
  `isCurrentUserAdmin()` derives the signed-in user's admin status from
  `currentUser()` (a real Backend API call), not from the session JWT's
  claims — Clerk's default session token doesn't include email unless a
  custom claim is configured, so trusting `sessionClaims` would have
  silently denied every admin.
- `lib/admin/user-summary.ts`: `listUsersWithUsage()` joins Clerk's user
  roster (`clerkClient().users.getUserList({ limit: 500 })`) with each
  user's Redis-backed resource count (`listResources`) and chat usage
  (`getChatUsage`) by `userId`.
- `app/admin/page.tsx`: Server Component — `await auth.protect()`, then
  `redirect("/")` if `isCurrentUserAdmin()` is false, otherwise fetches
  `listUsersWithUsage()` directly (no self-fetch round trip) and renders
  `AdminClient`.
- `GET /api/admin/users` and `PATCH /api/admin/users/[id]`: both gated by
  the same `isCurrentUserAdmin()` check (403 if not admin, distinct from
  the resource-ownership 404 pattern — there's no ownership ambiguity to
  hide for a role check). The `PATCH` route calls `setUnlimited(id,
  unlimited)`, the only "upgrade" action — removes the Phase 16 chat cap,
  no other tier concept, per the confirmed scope.
- UI (`components/admin/admin-client.tsx`): shadcn `Table` listing every
  user's name/email, resource count, chat usage, a status `Badge`
  (Free/Limit reached/Unlimited), and a `Switch` per row that PATCHes the
  unlimited flag with an optimistic update (reverted on failure). Installed
  `table` and `switch` via the shadcn CLI rather than hand-rolling them.
  `components/home/home-client.tsx` shows an "Admin" button (shadcn
  `Button` rendered as a `next/link` via the `render` prop, with
  `nativeButton={false}` since it's an anchor not a native button) only
  when `app/page.tsx`'s server-side `isCurrentUserAdmin()` check passes.
- Verified live: signed in as a non-admin, confirmed `/admin` redirects to
  `/`. Temporarily added a second email to `ADMIN_EMAILS` to test the
  admin-recognized path without needing the real admin's Google OAuth
  flow — confirmed the table renders both real Clerk users with correct
  resource/usage data, the "Admin" header button appears, and toggling the
  `Unlimited` switch persists to Redis and correctly bypasses the Phase 16
  cap in the live chat UI (badge disappears, input re-enables). Reverted
  the temporary allowlist addition and cleared all test-induced Redis state
  afterward.
- Added `lib/admin/is-admin.test.ts`: `isAdminEmail` case-insensitivity,
  comma-separated allowlist with whitespace, rejection of a non-listed or
  empty allowlist, and null/undefined email handling.
