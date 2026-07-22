<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent Operating Rules

This file defines how an AI agent (Claude Code or otherwise) must work in this
repository. It applies to every change, not just the RAG pipeline described in
`planning.md` and `specs.md`. Read those two files before starting any
non-trivial feature work — they contain the architecture and the phased plan
this codebase is being built against.

## 1. UI components: shadcn first, always

This project uses shadcn (`components.json`, style `base-nova`, base color
`neutral`, icons via `lucide-react`). Before writing any new UI component:

1. Check whether shadcn already ships it. Look in `components/ui/` for an
   existing installed component first.
2. If it's not installed yet, add it via the CLI rather than hand-rolling it:
   `npx shadcn@latest add <component>`.
3. Only write a bespoke component from scratch when shadcn has no equivalent
   (e.g. domain-specific widgets like a "retrieval pipeline trace" viewer).
   Bespoke components still go through `class-variance-authority` + `cn()`
   (`lib/utils.ts`) so they match the installed design system.
4. Never copy-paste component code from memory/training data instead of
   running the CLI — versions and APIs drift, and the installed registry
   (`components.json` → `registries`) is the source of truth.

## 2. Testing happens after the feature is whole

Do not write or run tests mid-implementation. Build the full vertical slice
of a feature (UI + API route + lib logic + queue/worker code, as applicable)
first, get it working end-to-end, and only then add tests for it. Exceptions:
a failing test the user explicitly asked you to fix, or a regression you were
asked to reproduce first.

## 3. Folder structure

Keep the codebase organized by responsibility, not by type-of-file-dump.
Follow the structure laid out in `planning.md` ("Proposed folder structure").
In short:

- `app/` — Next.js App Router routes, layouts, and API routes only. No
  business logic lives here beyond request parsing / response shaping.
- `components/ui/` — shadcn-managed components only. Don't hand-edit these
  beyond what `shadcn add`/theming requires.
- `components/` (outside `ui/`) — feature-level, app-specific components.
- `lib/` — all business logic: guardrails, query transformation, retrieval
  adapters, ranking, generation, CRAG evaluation, LLM provider routing, DB
  clients. Organized in subfolders per pipeline stage (see `planning.md`).
- `workers/` — standalone BullMQ worker process entrypoints (not served by
  Next.js request handlers).
- `specs.md` / `planning.md` — living design docs. Update them when the
  architecture changes; don't let them drift from the code.

## 4. General engineering rules

- Prefer editing existing files over creating new ones; don't create
  documentation files beyond what's requested.
- No speculative abstractions — build for the pipeline stage in front of you,
  not for hypothetical future providers/DBs, but keep provider/DB access
  behind the interfaces defined in `specs.md` so swapping implementations
  doesn't require touching call sites.
- Guardrail and CRAG logic is security- and correctness-critical: never bypass
  or stub out the input/output guardrail calls to "make it work" — see
  `specs.md` §Guardrails.
- Secrets (LLM API keys, DB credentials, Redis URL) go through environment
  variables only, never hardcoded or logged.
