# Advanced RAG

A retrieval-augmented generation app built end-to-end: multi-format
ingestion (PDF, Markdown, SRT/VTT, YouTube, web pages), input guardrails,
query understanding (rewrite/stepback/sub-questions/HyDE), vector
retrieval, ranking, generation with clickable citations, a CRAG
self-correction loop, and output guardrails — all visible in real time via
a pipeline-trace panel.

For the full architecture and phased build history, see [`specs.md`](specs.md)
and [`planning.md`](planning.md). [`AGENTS.md`](AGENTS.md) documents the
engineering conventions this repo follows.

## Prerequisites

- **Node.js 20.9+** (Next.js 16's minimum)
- **A Redis instance** — either running locally or a free
  [Redis Cloud](https://redis.io/try-free/) database. Used as the BullMQ
  queue backend for ingestion.
- **A Qdrant Cloud cluster** — free tier works. Sign up at
  [cloud.qdrant.io](https://cloud.qdrant.io/). The vector collection is
  created automatically the first time a document is ingested.
- **An OpenAI API key** — [platform.openai.com](https://platform.openai.com/).
  Used for chat/completion and embeddings.
- **A Clerk application** — free at [clerk.com](https://clerk.com/). Every
  page and API route requires sign-in. Easiest setup: install the
  [Clerk CLI](https://clerk.com/docs/cli) (`npm install -g clerk`), run
  `clerk auth login`, then from the project root run
  `clerk init --app <your-app-id>` — it detects the existing Next.js/Clerk
  integration and writes the real keys straight into `.env.local`. (Manual
  alternative: copy `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and
  `CLERK_SECRET_KEY` from your Clerk dashboard's API Keys page yourself.)

## Setup

1. **Clone and install dependencies**

   ```bash
   git clone https://github.com/pradyumndaga/advacned-rag.git
   cd advacned-rag
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Fill in `.env.local`:

   | Variable | Required | Description |
   |---|---|---|
   | `OPENAI_API_KEY` | Yes | OpenAI API key |
   | `REDIS_URL` | No | Redis connection string. Defaults to `redis://localhost:6379` if unset |
   | `QDRANT_API_KEY` | Yes | Qdrant Cloud API key |
   | `QDRANT_DB` | Yes | Qdrant Cloud cluster URL (e.g. `https://xxxxxxxx.qdrant.io:6333`) |
   | `QDRANT_COLLECTION` | No | Collection name for indexed chunks. Defaults to `advanced-rag-chunks` |
   | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Yes | Clerk publishable key |
   | `CLERK_SECRET_KEY` | Yes | Clerk secret key |

   If running Redis locally instead of Redis Cloud, install and start it
   first (e.g. `brew install redis && brew services start redis` on macOS),
   and you can leave `REDIS_URL` unset.

## Running the app

This project needs **two processes running at the same time**:

```bash
# Terminal 1 — the Next.js app
npm run dev
```

```bash
# Terminal 2 — the BullMQ worker (handles document ingestion)
npm run worker
```

Then open [http://localhost:3000](http://localhost:3000).

> **Why two processes?** Ingestion (loading, chunking, embedding, and
> upserting a document) runs as a background BullMQ job so uploading a
> large file doesn't block a request. If `npm run worker` isn't running,
> uploaded sources will sit in the "Queued" state forever — see
> `specs.md` §5 for why ingestion (and only ingestion) is queued this way.

### Using the app

0. Sign up for an account (or sign in) at `/sign-in` — every page and API
   route requires an authenticated session.
1. Add a source using the row of drop-zone cards at the top — PDF,
   Markdown, or SRT/VTT files by drag-and-drop or click; YouTube or web
   page links by pasting a URL.
2. Watch it move through **Queued → Processing → Ready** in the Resources
   panel on the left (a red dot means it failed — hover for the error).
3. Once at least one source is **Ready**, ask a question in the chat.
   The pipeline-trace panel on the right shows every real stage as it
   runs — guardrails, query transforms, retrieval, ranking, generation,
   CRAG evaluation, and output guardrails.
4. Click any `[N]` citation in an answer, or the source chip underneath
   it, to open that exact chunk in a preview.

## Running tests

```bash
npm test          # run once
npm run test:watch
```

65 tests (Vitest) cover guardrail logic, ingestion parsing/chunking,
ranking, the CRAG retry loop, and resource lifecycle transitions — see
`planning.md`'s Phase 12 section for what's covered and how external
calls (LLM, embeddings, Redis) are mocked.

## Other scripts

```bash
npm run build   # production build
npm run start   # run a production build (still needs npm run worker alongside it)
npm run lint    # ESLint
```

## Deploying

The Next.js app deploys to Vercel as-is (verified: `npm run build` succeeds
unmodified). The one thing that **can't** move to Vercel is the BullMQ
worker (`workers/index.ts`) — Vercel's serverless functions are stateless
and get frozen/killed between requests, so a process that listens
indefinitely for jobs can't live there. Without a worker running somewhere,
uploaded sources will sit in "Queued" forever.

This repo uses a **free** stand-in instead of paying for a second always-on
host: a GitHub Actions workflow
(`.github/workflows/drain-ingestion-queue.yml`) runs every 5 minutes,
processes whatever's currently queued via `npm run worker:drain`
(`workers/drain.ts` — same processors as `workers/index.ts`, but it exits
once both queues have gone idle for ~15s instead of running forever), then
stops. The tradeoff: a newly-added source can take up to roughly 5-10
minutes to finish ingesting instead of a few seconds, since GitHub Actions'
shortest reliable schedule interval is 5 minutes (and even that isn't
perfectly precise — see the
[GitHub Actions docs on `schedule`](https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows#schedule)).
If that latency isn't acceptable, run `npm run worker` on any always-on
host instead (a small VPS, an Oracle Cloud/GCP "always free" VM, etc.) and
skip the workflow.

### 1. Deploy the app to Vercel

1. Push this repo to GitHub (already done if you're reading this from the
   repo).
2. In the [Vercel dashboard](https://vercel.com/new), import the repo.
   Framework preset auto-detects as Next.js — no build settings to change.
3. Add the same environment variables from `.env.local` under
   **Settings → Environment Variables**: `OPENAI_API_KEY`, `REDIS_URL`,
   `QDRANT_API_KEY`, `QDRANT_DB`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`,
   `CLERK_SECRET_KEY`, and optionally `QDRANT_COLLECTION`.
4. Deploy. `REDIS_URL` and `QDRANT_DB` need to point at instances reachable
   from the public internet (Redis Cloud and Qdrant Cloud both are) — a
   Redis running on `localhost` won't be reachable from Vercel.

   Clerk's **development** keys (what local setup uses) work but log a
   warning and have strict usage limits — for a real deployment, create a
   **production instance** in the Clerk dashboard and use its keys instead.

### 2. Set up the ingestion workflow

1. In the GitHub repo, go to **Settings → Secrets and variables → Actions**
   and add the same values as repo secrets: `OPENAI_API_KEY`, `REDIS_URL`,
   `QDRANT_API_KEY`, `QDRANT_DB`, `QDRANT_COLLECTION` (optional).
2. That's it — `.github/workflows/drain-ingestion-queue.yml` starts running
   on its 5-minute schedule automatically once the secrets exist. You can
   also trigger it manually from the **Actions** tab (the workflow has a
   `workflow_dispatch` trigger) to test it or to process a queued source
   immediately instead of waiting for the next scheduled run.
3. GitHub disables scheduled workflows automatically after 60 days with no
   commits to the repo — push occasionally, or re-enable it manually from
   the Actions tab if that happens.

## Known limitations

- Only the vector-DB retrieval adapter is implemented (keyword/SQL/graph
  are designed for but not built — see `specs.md` §4.4).
- The web page loader can't render client-side (JS-rendered SPA) pages —
  it fetches raw HTML only, so a page whose content loads via JavaScript
  after the initial load will fail with a clear error explaining why.
- Credentials are read from server-side environment variables for now,
  not per-visitor BYOK — see `specs.md` §0 for the deferred future
  direction (Vercel + BYOK deployment).
