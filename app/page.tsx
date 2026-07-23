"use client"

import * as React from "react"

import { ChatPanel, type ChatMessage } from "@/components/chat/chat-panel"
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

export default function Home() {
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
  const timeouts = React.useRef<ReturnType<typeof setTimeout>[]>([])

  React.useEffect(() => {
    const pending = timeouts.current
    return () => {
      pending.forEach(clearTimeout)
    }
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
    const [guardrailStage, queryUnderstandingStage, ...restStages] = PIPELINE_STAGES

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
      queryUnderstanding?: { count: number; types: string[] }
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

    // Query understanding also already ran server-side by the time this
    // response arrived — guardrail check, transforms, and generation all
    // happen in one request, so there's no separate "active" window to show
    // for this stage yet. Append it already resolved, with a real summary of
    // what the transforms actually produced.
    const qu = data.queryUnderstanding
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
        },
      ])
    }, restStages.length * 350 + 300)
    timeouts.current.push(reply)
  }

  return (
    <div className="mx-auto flex h-screen w-full max-w-7xl flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Advanced RAG</h1>
          <p className="text-sm text-muted-foreground">
            Add source documents, ask a question, and watch the retrieval
            pipeline run.
          </p>
        </div>
        <ModeToggle />
      </header>

      <section className="rounded-xl border border-border bg-card p-4">
        <IngestPanel onIngested={() => setResourceRefreshSignal((n) => n + 1)} />
      </section>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 md:grid-cols-[220px_minmax(0,1fr)_minmax(0,1fr)]">
        <section className="min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <ResourcePanel
            refreshSignal={resourceRefreshSignal}
            onSelect={(resourceId) => setPreviewTarget({ sourceId: resourceId })}
          />
        </section>
        <section className="min-h-0 min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <ChatPanel messages={messages} onSendMessage={handleSendMessage} />
        </section>
        <section className="min-h-0 min-w-0">
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
