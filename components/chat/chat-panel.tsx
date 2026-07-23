"use client"

import * as React from "react"
import { Send, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"
import { Citation } from "@/lib/types"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  citations?: Citation[]
}

interface ChatPanelProps {
  messages: ChatMessage[]
  onSendMessage: (content: string) => void
  onCiteClick?: (citation: Citation) => void
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

export function ChatPanel({ messages, onSendMessage, onCiteClick }: ChatPanelProps) {
  const [value, setValue] = React.useState("")
  const viewportRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    viewportRef.current?.scrollTo({ top: viewportRef.current.scrollHeight })
  }, [messages])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    onSendMessage(trimmed)
    setValue("")
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Chat</h2>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div ref={viewportRef} className="flex flex-col gap-4 p-4">
          {messages.map((message) => (
            <div
              key={message.id}
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
                  "max-w-[75%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                )}
              >
                {renderContent(message.content, message.citations, onCiteClick)}
              </div>
            </div>
          ))}
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
          placeholder="Ask a question about your documents..."
          className="min-h-9 resize-none"
          rows={1}
        />
        <Button type="submit" size="icon" disabled={!value.trim()}>
          <Send />
        </Button>
      </form>
    </div>
  )
}
