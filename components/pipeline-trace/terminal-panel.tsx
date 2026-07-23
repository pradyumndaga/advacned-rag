"use client"

import * as React from "react"
import { CheckCircle2, CircleDashed, Loader2, TerminalSquare, XCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"

export type TraceStatus = "pending" | "active" | "done" | "blocked"

export interface TraceLine {
  id: string
  label: string
  detail?: string
  status: TraceStatus
  timestamp: string
}

const statusIcon: Record<TraceStatus, React.ReactNode> = {
  pending: <CircleDashed className="size-3.5 text-zinc-600" />,
  active: <Loader2 className="size-3.5 animate-spin text-zinc-200" />,
  done: <CheckCircle2 className="size-3.5 text-emerald-400" />,
  blocked: <XCircle className="size-3.5 text-red-400" />,
}

interface TerminalPanelProps {
  lines: TraceLine[]
}

export function TerminalPanel({ lines }: TerminalPanelProps) {
  const viewportRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight })
  }, [lines])

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl bg-zinc-950 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-zinc-700" />
          <span className="size-2.5 rounded-full bg-zinc-700" />
          <span className="size-2.5 rounded-full bg-zinc-700" />
        </div>
        <TerminalSquare className="ml-1.5 size-3.5 text-zinc-500" />
        <h2 className="font-mono text-xs text-zinc-400">pipeline-trace</h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={viewportRef} className="flex flex-col gap-1.5 p-4 font-mono text-xs">
          {lines.length === 0 && (
            <p className="text-zinc-600">
              $ waiting for a query
              <span className="ml-0.5 animate-pulse">_</span>
            </p>
          )}
          {lines.map((line) => (
            <div key={line.id} className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 text-zinc-600">[{line.timestamp}]</span>
              <span className="shrink-0">{statusIcon[line.status]}</span>
              <span
                className={cn(
                  "shrink-0",
                  line.status === "done" && "text-zinc-300",
                  line.status === "active" && "text-zinc-100",
                  line.status === "pending" && "text-zinc-600",
                  line.status === "blocked" && "text-red-400"
                )}
              >
                {line.label}
              </span>
              {line.detail && (
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    line.status === "blocked" ? "text-red-400/80" : "text-zinc-500"
                  )}
                >
                  {line.detail}
                </span>
              )}
            </div>
          ))}
          {lines.length > 0 && (
            <span className="mt-1 text-zinc-300">
              ${" "}
              <span className="animate-pulse">_</span>
            </span>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
