"use client"

import * as React from "react"
import Link from "next/link"
import { UserButton } from "@clerk/nextjs"
import { ShieldCheck } from "lucide-react"

import { ChatPanel, type ChatMessage, type ChatUsage } from "@/components/chat/chat-panel"
import { Button } from "@/components/ui/button"
import { ModeToggle } from "@/components/mode-toggle"
import {
  TerminalPanel,
  type TraceLine,
} from "@/components/pipeline-trace/terminal-panel"
import { IngestPanel } from "@/components/upload/ingest-panel"
import { ResourcePanel } from "@/components/resources/resource-panel"
import {
  ResourcePreview,
  type ResourcePreviewTarget,
} from "@/components/resources/resource-preview"
import type { Citation } from "@/lib/types"

const PIPELINE_STAGES = [
  "input-guardrails",
  "query-understanding",
  "route-adaptor",
  "retrieval",
  "ranking",
  "generation",
  "crag-eval",
  "output-guardrails",
] as const

function timestamp() {
  return new Date().toLocaleTimeString("en-US", { hour12: false })
}

interface HomeClientProps {
  isAdmin?: boolean
}

export function HomeClient({ isAdmin }: HomeClientProps) {
  const [messages, setMessages] = React.useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Add a few sources above — PDFs, Markdown, subtitles, a YouTube link, or a web page — then ask a question. This is a UI preview — the retrieval pipeline isn't wired up yet.",
    },
  ])
  const [lines, setLines] = React.useState<TraceLine[]>([])
  const [resourceRefreshSignal, setResourceRefreshSignal] = React.useState(0)
  const [previewTarget, setPreviewTarget] = React.useState<ResourcePreviewTarget | null>(null)
  const [usage, setUsage] = React.useState<ChatUsage | undefined>(undefined)
  const timeouts = React.useRef<ReturnType<typeof setTimeout>[]>([])

  React.useEffect(() => {
    const pending = timeouts.current
    return () => {
      pending.forEach(clearTimeout)
    }
  }, [])

  React.useEffect(() => {
    fetch("/api/usage")
      .then((res) => res.json())
      .then((data: { usage?: ChatUsage }) => {
        if (data.usage) setUsage(data.usage)
      })
      .catch(() => {})
  }, [])

  function updateLine(runId: number, stage: string, patch: Partial<TraceLine>) {
    setLines((prev) =>
      prev.map((line) =>
        line.id === `${runId}-${stage}`
          ? { ...line, ...patch, timestamp: timestamp() }
          : line
      )
    )
  }

  async function handleSendMessage(content: string) {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: "user", content },
    ])

    const runId = Date.now()
    const [
      guardrailStage,
      queryUnderstandingStage,
      routeAdaptorStage,
      retrievalStage,
      rankingStage,
      generationStage,
      cragStage,
      outputGuardrailStage,
      ...restStages
    ] = PIPELINE_STAGES

    // Only the stages that are actually going to run get a line — a stage
    // further down the pipeline must not appear until the one before it has
    // succeeded, so a failure never shows steps that were never reached.
    setLines((prev) => [
      ...prev,
      {
        id: `${runId}-query`,
        label: `query "${content}"`,
        status: "done",
        timestamp: timestamp(),
      },
      {
        id: `${runId}-${guardrailStage}`,
        label: guardrailStage,
        status: "active",
        timestamp: timestamp(),
      },
    ])

    // Real call: the input guardrail actually runs server-side before anything
    // else, so the UI waits on it instead of animating on a timer.
    let res: Response
    let data: {
      content?: string
      refused?: boolean
      reason?: string
      error?: string
      limitReached?: boolean
      lowConfidence?: boolean
      queryUnderstanding?: { count: number; types: string[] }
      retrieval?: { count: number; sources: string[] }
      ranking?: { candidates: number; ranked: number }
      crag?: { attempts: number; score: number; lowConfidence: boolean }
      outputGuardrail?: { action: "none" | "redacted" | "refused"; reason?: string }
      citations?: Citation[]
      usage?: ChatUsage
    }
    try {
      res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: content }),
      })
      data = await res.json()
    } catch {
      updateLine(runId, guardrailStage, { status: "blocked", detail: "network error" })
      setMessages((prev) => [
        ...prev,
        {
          id: `${runId}-assistant`,
          role: "assistant",
          content: "Something went wrong reaching the server.",
        },
      ])
      return
    }

    if (data.usage) setUsage(data.usage)

    if (data.limitReached) {
      updateLine(runId, guardrailStage, { status: "blocked", detail: "free chat limit reached" })
      setMessages((prev) => [
        ...prev,
        {
          id: `${runId}-assistant`,
          role: "assistant",
          content:
            "You've used all 10 free chats. Contact an admin for unlimited access.",
        },
      ])
      return
    }

    if (data.refused) {
      updateLine(runId, guardrailStage, { status: "blocked", detail: data.reason })
      setMessages((prev) => [
        ...prev,
        {
          id: `${runId}-assistant`,
          role: "assistant",
          content: `Blocked by the input guardrail${data.reason ? `: ${data.reason}` : "."}`,
        },
      ])
      return
    }

    updateLine(runId, guardrailStage, { status: "done" })

    // Query understanding, route-adaptor, and retrieval all already ran
    // server-side by the time this response arrived — guardrail check,
    // transforms, retrieval, and generation all happen in one request, so
    // there's no separate "active" window to show for these stages yet.
    // Append them already resolved, with real summaries of what actually
    // happened.
    const qu = data.queryUnderstanding
    const retrieval = data.retrieval
    const ranking = data.ranking
    setLines((prev) => [
      ...prev,
      {
        id: `${runId}-${queryUnderstandingStage}`,
        label: queryUnderstandingStage,
        status: "done",
        detail:
          qu && qu.count > 0
            ? `${qu.count} transforms (${qu.types.join(", ")})`
            : "no transforms produced — continuing with original query",
        timestamp: timestamp(),
      },
      {
        id: `${runId}-${routeAdaptorStage}`,
        label: routeAdaptorStage,
        status: "done",
        detail:
          retrieval && retrieval.sources.length > 0
            ? `routed to: ${retrieval.sources.join(", ")}`
            : "no adapter matched",
        timestamp: timestamp(),
      },
      {
        id: `${runId}-${retrievalStage}`,
        label: retrievalStage,
        status: "done",
        detail:
          retrieval && retrieval.count > 0
            ? `${retrieval.count} chunks retrieved`
            : "no matching chunks found",
        timestamp: timestamp(),
      },
      {
        id: `${runId}-${rankingStage}`,
        label: rankingStage,
        status: "done",
        detail:
          ranking && ranking.ranked > 0
            ? `${ranking.candidates} candidates → ${ranking.ranked} after de-dup + re-rank`
            : "nothing to rank",
        timestamp: timestamp(),
      },
      {
        id: `${runId}-${generationStage}`,
        label: generationStage,
        status: "done",
        detail:
          data.citations && data.citations.length > 0
            ? `gpt-4o response, ${data.citations.length} citable chunks`
            : "gpt-4o response, no context to cite",
        timestamp: timestamp(),
      },
      {
        id: `${runId}-${cragStage}`,
        label: cragStage,
        status: "done",
        detail: data.crag
          ? `score ${data.crag.score.toFixed(2)}/1.00, ${data.crag.attempts} attempt${data.crag.attempts > 1 ? "s" : ""}${data.crag.lowConfidence ? " — low confidence" : ""}`
          : "no evaluation",
        timestamp: timestamp(),
      },
      {
        id: `${runId}-${outputGuardrailStage}`,
        label: outputGuardrailStage,
        status: data.outputGuardrail?.action === "refused" ? "blocked" : "done",
        detail: data.outputGuardrail?.reason ?? "no changes needed",
        timestamp: timestamp(),
      },
    ])

    // Only now append the remaining stages — they're not implemented yet, so
    // this keeps the preview animation, but they still don't appear at all
    // unless the guardrail actually passed.
    setLines((prev) => [
      ...prev,
      ...restStages.map((stage) => ({
        id: `${runId}-${stage}`,
        label: stage,
        status: "pending" as const,
        timestamp: timestamp(),
      })),
    ])

    restStages.forEach((stage, i) => {
      const activate = setTimeout(() => {
        updateLine(runId, stage, { status: "active" })
      }, i * 350)
      const complete = setTimeout(() => {
        updateLine(runId, stage, { status: "done" })
      }, i * 350 + 250)
      timeouts.current.push(activate, complete)
    })

    const reply = setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          id: `${runId}-assistant`,
          role: "assistant",
          content: data.content ?? "Something went wrong reaching the model.",
          citations: data.citations,
          lowConfidence: data.lowConfidence,
        },
      ])
    }, restStages.length * 350 + 300)
    timeouts.current.push(reply)
  }

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 md:h-screen">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Advanced RAG</h1>
          <p className="text-sm text-muted-foreground">
            Add source documents, ask a question, and watch the retrieval
            pipeline run.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href="/admin">
                  <ShieldCheck />
                  Admin
                </Link>
              }
            />
          )}
          <ModeToggle />
          <UserButton />
        </div>
      </header>

      <section className="rounded-xl border border-border bg-card p-3">
        <IngestPanel onIngested={() => setResourceRefreshSignal((n) => n + 1)} />
      </section>

      {/* Below md, this grid falls back to a single column (3 stacked
          rows) — each panel needs an explicit height in that mode since
          there's no shared row height to stretch into like there is when
          they're laid out side by side. At md+, height comes from the grid
          row via the flex-1 parent instead, so it's reset to auto there. */}
      <div className="grid grid-cols-1 gap-4 md:min-h-0 md:flex-1 md:grid-cols-[220px_minmax(0,2fr)_minmax(0,1fr)]">
        <section className="h-80 min-w-0 overflow-hidden rounded-xl border border-border bg-card md:h-auto md:min-h-0">
          <ResourcePanel
            refreshSignal={resourceRefreshSignal}
            onSelect={(resourceId) => setPreviewTarget({ sourceId: resourceId })}
          />
        </section>
        <section className="h-96 min-w-0 overflow-hidden rounded-xl border border-border bg-card md:h-auto md:min-h-0">
          <ChatPanel
            messages={messages}
            onSendMessage={handleSendMessage}
            usage={usage}
            onCiteClick={(citation) =>
              setPreviewTarget({
                sourceId: citation.sourceId,
                chunkId: String(citation.chunkIndex),
              })
            }
          />
        </section>
        <section className="h-80 min-w-0 md:h-auto md:min-h-0">
          <TerminalPanel lines={lines} />
        </section>
      </div>

      <ResourcePreview
        target={previewTarget}
        onOpenChange={(open) => {
          if (!open) setPreviewTarget(null)
        }}
      />
    </div>
  )
}
