"use client"

import * as React from "react"
import { ExternalLink } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { Resource, StoredChunk } from "@/lib/ingestion/types"

// Handles watch/short/live URLs, the youtu.be shortlink, and an
// already-embed URL, with or without trailing query params (?t=30s etc).
function extractYoutubeVideoId(url: string): string | null {
  const match = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/
  )
  return match ? match[1] : null
}

// specs.md §3.3: the same target shape (and this same component) is reused
// for citation click-through once generation ships — chunkId lets a caller
// scroll to and highlight a specific chunk instead of just opening the doc.
export interface ResourcePreviewTarget {
  sourceId: string
  chunkId?: string
}

interface ResourcePreviewProps {
  target: ResourcePreviewTarget | null
  onOpenChange: (open: boolean) => void
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function ResourcePreview({ target, onOpenChange }: ResourcePreviewProps) {
  const [resource, setResource] = React.useState<Resource | null>(null)
  const [chunks, setChunks] = React.useState<StoredChunk[]>([])
  const [loadedFor, setLoadedFor] = React.useState<string | null>(null)
  const highlightRef = React.useRef<HTMLDivElement | null>(null)

  // Derived, not stored: avoids a synchronous setState at the top of the
  // effect (the fetch below only sets state from its .then() callback, once
  // data actually arrives).
  const loading = Boolean(target) && loadedFor !== target?.sourceId

  React.useEffect(() => {
    if (!target) return
    let cancelled = false
    fetch(`/api/resources/${target.sourceId}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setResource(data.resource ?? null)
        setChunks(data.chunks ?? [])
        setLoadedFor(target.sourceId)
      })
    return () => {
      cancelled = true
    }
  }, [target])

  React.useEffect(() => {
    if (!target?.chunkId || !highlightRef.current) return
    highlightRef.current.scrollIntoView({ block: "center", behavior: "smooth" })
  }, [target, chunks])

  const isTimed = chunks.some((c) => c.startTime !== undefined)
  const youtubeVideoId = resource?.kind === "youtube" ? extractYoutubeVideoId(resource.label) : null

  // A citation click (target.chunkId set) always means "jump to this exact
  // passage" — that only makes sense against the chunk view, regardless of
  // kind. Opening a resource directly from the panel (no chunkId) is when
  // the richer, kind-specific preview applies.
  const mode: "youtube" | "webpage" | "pdf" | "rawText" | "chunks" = target?.chunkId
    ? "chunks"
    : resource?.kind === "youtube" && youtubeVideoId
      ? "youtube"
      : resource?.kind === "webpage"
        ? "webpage"
        : resource?.kind === "pdf" && resource.fileUrl
          ? "pdf"
          : resource?.kind === "markdown" && resource.rawText
            ? "rawText"
            : "chunks"

  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "max-h-[80vh] max-w-2xl sm:max-w-2xl",
          mode === "pdf" && "sm:max-w-4xl"
        )}
      >
        <DialogHeader>
          <DialogTitle className="truncate">
            {resource?.label ?? "Preview"}
          </DialogTitle>
        </DialogHeader>

        {loading && (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}

        {!loading && mode === "youtube" && (
          <div className="aspect-video w-full overflow-hidden rounded-lg">
            <iframe
              className="h-full w-full"
              src={`https://www.youtube.com/embed/${youtubeVideoId}`}
              title={resource?.label}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}

        {!loading && mode === "webpage" && (
          <div className="flex flex-col items-start gap-3 p-2">
            <p className="text-sm text-muted-foreground">
              Web pages open in a new tab — most sites block being embedded
              directly.
            </p>
            <Button
              variant="outline"
              nativeButton={false}
              render={
                <a href={resource?.label} target="_blank" rel="noopener noreferrer">
                  <ExternalLink />
                  Open original page
                </a>
              }
            />
          </div>
        )}

        {!loading && mode === "pdf" && resource && (
          <iframe
            src={`/api/resources/${resource.id}/file`}
            title={resource.label}
            className="h-[65vh] w-full rounded-lg border border-border"
          />
        )}

        {!loading && mode === "rawText" && resource?.rawText && (
          <ScrollArea className="h-[60vh] pr-4">
            <p className="whitespace-pre-wrap p-2 text-sm leading-relaxed text-foreground/90">
              {resource.rawText}
            </p>
          </ScrollArea>
        )}

        {!loading && mode === "chunks" && (
          <ScrollArea className="h-[60vh] pr-4">
            {chunks.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No content indexed yet.
              </p>
            )}

            {isTimed && (
              <div className="flex flex-col gap-3">
                {chunks.map((chunk) => {
                  const isHighlighted = target?.chunkId === String(chunk.chunkIndex)
                  return (
                    <div
                      key={chunk.chunkIndex}
                      ref={isHighlighted ? highlightRef : undefined}
                      className={cn(
                        "flex gap-3 rounded-lg p-2 text-sm transition-colors",
                        isHighlighted && "bg-amber-500/10 ring-1 ring-amber-500/40"
                      )}
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {formatTime(chunk.startTime ?? 0)}
                      </span>
                      <p className="text-foreground/90">{chunk.text}</p>
                    </div>
                  )
                })}
              </div>
            )}

            {!isTimed && chunks.length > 0 && (
              <div className="flex flex-col gap-3">
                {chunks.map((chunk) => {
                  const isHighlighted = target?.chunkId === String(chunk.chunkIndex)
                  return (
                    <p
                      key={chunk.chunkIndex}
                      ref={isHighlighted ? highlightRef : undefined}
                      className={cn(
                        "whitespace-pre-wrap rounded-lg p-2 text-sm leading-relaxed text-foreground/90 transition-colors",
                        isHighlighted && "bg-amber-500/10 ring-1 ring-amber-500/40"
                      )}
                    >
                      {chunk.text}
                    </p>
                  )
                })}
              </div>
            )}
          </ScrollArea>
        )}
      </DialogContent>
    </Dialog>
  )
}
