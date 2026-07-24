"use client"

import * as React from "react"
import { AlertTriangle, Send, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Citation } from "@/lib/types"
import { SOURCE_ICONS } from "@/components/resources/source-icon"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
  lowConfidence?: boolean
}

export interface ChatUsage {
  count: number
  limit: number
  unlimited: boolean
}

interface ChatPanelProps {
  messages: ChatMessage[]
  onSendMessage: (content: string) => void
  onCiteClick?: (citation: Citation) => void
  usage?: ChatUsage
}

// The model is instructed to cite passages inline as "[1]", "[2]", etc.,
// numbered the same way they were shown to it — swap each one that maps to
// a real citation into a clickable chip; anything else (an out-of-range or
// hallucinated bracket) just renders as plain text.
function renderContent(
  content: string,
  citations: Citation[] | undefined,
  onCiteClick: ((citation: Citation) => void) | undefined
) {
  if (!citations?.length || !onCiteClick) return content

  const parts: React.ReactNode[] = []
  const pattern = /\[(\d+)\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = pattern.exec(content)) !== null) {
    const citation = citations[Number(match[1]) - 1]
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index))
    }
    if (citation) {
      parts.push(
        <button
          key={`cite-${key++}`}
          type="button"
          onClick={() => onCiteClick(citation)}
          title={citation.label}
          className="mx-0.5 rounded bg-primary/15 px-1 py-0.5 align-baseline text-xs font-medium text-primary hover:bg-primary/25"
        >
          [{match[1]}]
        </button>
      )
    } else {
      parts.push(match[0])
    }
    lastIndex = pattern.lastIndex
  }
  if (lastIndex < content.length) parts.push(content.slice(lastIndex))

  return parts
}

// The "Sources" row under a response shows only citations the model actually
// referenced (a "[N]" literally present in its answer text), deduped to one
// entry per source document — a source cited via three different chunks
// should still only show up once in this list.
function usedSources(content: string, citations: Citation[] | undefined): Citation[] {
  if (!citations?.length) return []

  const used: Citation[] = []
  const seenSourceIds = new Set<string>()
  const pattern = /\[(\d+)\]/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(content)) !== null) {
    const citation = citations[Number(match[1]) - 1]
    if (citation && !seenSourceIds.has(citation.sourceId)) {
      seenSourceIds.add(citation.sourceId)
      used.push(citation)
    }
  }
  return used
}

export function ChatPanel({ messages, onSendMessage, onCiteClick, usage }: ChatPanelProps) {
  const [value, setValue] = React.useState("")
  const viewportRef = React.useRef<HTMLDivElement>(null)
  const limitReached = Boolean(usage && !usage.unlimited && usage.count >= usage.limit)

  React.useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight })
  }, [messages])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed || limitReached) return
    onSendMessage(trimmed)
    setValue("")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">Chat</h2>
        </div>
        {usage && !usage.unlimited && (
          <span
            className={cn(
              "text-xs tabular-nums",
              limitReached ? "font-medium text-red-400" : "text-muted-foreground"
            )}
          >
            {usage.count}/{usage.limit} chats used
          </span>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={viewportRef} className="flex flex-col gap-4 p-4">
          {messages.map((message) => {
            const sources = usedSources(message.content, message.citations)
            return (
              <div
                key={message.id}
                className={cn(
                  "flex flex-col gap-1.5",
                  message.role === "user" && "items-end"
                )}
              >
                <div
                  className={cn(
                    "flex items-start gap-2.5",
                    message.role === "user" && "flex-row-reverse"
                  )}
                >
                  <Avatar size="sm">
                    <AvatarFallback>
                      {message.role === "user" ? "U" : "AI"}
                    </AvatarFallback>
                  </Avatar>
                  <div
                    className={cn(
                      // A percentage max-width here would resolve against
                      // this row's own shrink-to-fit width (it doesn't
                      // stretch, per the wrapper's items-end/items-start) —
                      // circular, and collapses to a tiny bubble regardless
                      // of content. A fixed cap sidesteps that entirely.
                      "max-w-[32rem] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    )}
                  >
                    {renderContent(message.content, message.citations, onCiteClick)}
                  </div>
                </div>

                {message.lowConfidence && (
                  <div className="ml-9 flex items-center gap-1.5 text-xs text-amber-500">
                    <AlertTriangle className="size-3.5" />
                    Low confidence — the retrieved context may not fully answer this.
                  </div>
                )}

                {sources.length > 0 && (
                  <div className="ml-9 flex flex-wrap gap-1.5">
                    {sources.map((citation) => {
                      const Icon = SOURCE_ICONS[citation.sourceType]
                      return (
                        <button
                          key={citation.sourceId}
                          type="button"
                          onClick={() => onCiteClick?.(citation)}
                          title={citation.label}
                          className="flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
                        >
                          <Icon className="size-3" />
                          <span className="max-w-40 truncate">{citation.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>

      <form
        onSubmit={handleSubmit}
        className="flex items-end gap-2 border-t border-border p-3"
      >
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              handleSubmit(e)
            }
          }}
          disabled={limitReached}
          placeholder={
            limitReached
              ? "Free chat limit reached — contact an admin for unlimited access."
              : "Ask a question about your documents..."
          }
          className="min-h-9 resize-none"
          rows={1}
        />
        <Button type="submit" size="icon" disabled={!value.trim() || limitReached}>
          <Send />
        </Button>
      </form>
    </div>
  )
}
