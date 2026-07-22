"use client"

import * as React from "react"
import { Send, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Textarea } from "@/components/ui/textarea"

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
}

interface ChatPanelProps {
  messages: ChatMessage[]
  onSendMessage: (content: string) => void
}

export function ChatPanel({ messages, onSendMessage }: ChatPanelProps) {
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
                {message.content}
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
