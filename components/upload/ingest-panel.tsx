"use client"

import * as React from "react"
import {
  Captions,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileType2,
  Globe,
  Info,
  Loader2,
  PlayCircle,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

export type UiSourceKind =
  | "pdf"
  | "markdown"
  | "subtitles"
  | "youtube"
  | "webpage"
  | "docx"
  | "spreadsheet"

interface SourceTypeConfig {
  kind: UiSourceKind
  title: string
  description: string
  icon: React.ElementType
  input: "file" | "url"
  accept?: string
  matchesFile?: (file: File) => boolean
}

const SOURCE_TYPES: SourceTypeConfig[] = [
  {
    kind: "pdf",
    title: "PDF",
    description: "Reports, papers, PDF documents.",
    icon: FileText,
    input: "file",
    accept: "application/pdf",
    matchesFile: (file) => file.type === "application/pdf",
  },
  {
    kind: "markdown",
    title: "Markdown",
    description: "Docs-as-code, READMEs, notes.",
    icon: FileCode2,
    input: "file",
    accept: ".md,.markdown,text/markdown",
    matchesFile: (file) => /\.(md|markdown)$/i.test(file.name),
  },
  {
    kind: "subtitles",
    title: "Subtitles",
    description: "SRT & VTT transcript files.",
    icon: Captions,
    input: "file",
    accept: ".srt,.vtt",
    matchesFile: (file) => /\.(srt|vtt)$/i.test(file.name),
  },
  {
    kind: "docx",
    title: "Word",
    description: "Word documents (.docx).",
    icon: FileType2,
    input: "file",
    accept:
      ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    matchesFile: (file) => /\.docx$/i.test(file.name),
  },
  {
    kind: "spreadsheet",
    title: "Spreadsheet",
    description: "CSV & Excel files.",
    icon: FileSpreadsheet,
    input: "file",
    accept:
      ".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    matchesFile: (file) => /\.(csv|xlsx|xls)$/i.test(file.name),
  },
  {
    kind: "youtube",
    title: "YouTube",
    description: "Paste a video link — we pull the captions.",
    icon: PlayCircle,
    input: "url",
  },
  {
    kind: "webpage",
    title: "Web page",
    description: "Paste any URL — we extract the page content.",
    icon: Globe,
    input: "url",
  },
]

interface IngestPanelProps {
  onIngested: () => void
}

export function IngestPanel({ onIngested }: IngestPanelProps) {
  const [dragOverKind, setDragOverKind] = React.useState<UiSourceKind | null>(null)
  const [activeUrlKind, setActiveUrlKind] = React.useState<UiSourceKind | null>(null)
  const [urlValue, setUrlValue] = React.useState("")
  const [busyKinds, setBusyKinds] = React.useState<Set<UiSourceKind>>(new Set())
  const [errorByKind, setErrorByKind] = React.useState<Partial<Record<UiSourceKind, string>>>({})
  const fileInputRefs = React.useRef<Partial<Record<UiSourceKind, HTMLInputElement | null>>>({})

  const activeUrlType = activeUrlKind
    ? SOURCE_TYPES.find((type) => type.kind === activeUrlKind)
    : undefined

  function setBusy(kind: UiSourceKind, busy: boolean) {
    setBusyKinds((prev) => {
      const next = new Set(prev)
      if (busy) next.add(kind)
      else next.delete(kind)
      return next
    })
  }

  function setError(kind: UiSourceKind, message: string | null) {
    setErrorByKind((prev) => {
      const next = { ...prev }
      if (message) next[kind] = message
      else delete next[kind]
      return next
    })
  }

  async function uploadFile(type: SourceTypeConfig, file: File) {
    setBusy(type.kind, true)
    setError(type.kind, null)
    try {
      const formData = new FormData()
      formData.append("kind", type.kind)
      formData.append("file", file)
      const res = await fetch("/api/ingest", { method: "POST", body: formData })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? "upload failed")
      }
      onIngested()
    } catch (err) {
      setError(type.kind, err instanceof Error ? err.message : "upload failed")
    } finally {
      setBusy(type.kind, false)
    }
  }

  function handleFileList(type: SourceTypeConfig, fileList: FileList | null) {
    if (!fileList) return
    Array.from(fileList)
      .filter((file) => !type.matchesFile || type.matchesFile(file))
      .forEach((file) => uploadFile(type, file))
  }

  async function handleUrlSubmit() {
    if (!activeUrlType) return
    const trimmed = urlValue.trim()
    if (!trimmed) return

    setBusy(activeUrlType.kind, true)
    setError(activeUrlType.kind, null)
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: activeUrlType.kind, url: trimmed }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? "could not add link")
      }
      setUrlValue("")
      onIngested()
    } catch (err) {
      setError(activeUrlType.kind, err instanceof Error ? err.message : "could not add link")
    } finally {
      setBusy(activeUrlType.kind, false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        {SOURCE_TYPES.map((type) => {
          const Icon = type.icon
          const isFile = type.input === "file"
          const isBusy = busyKinds.has(type.kind)
          const error = errorByKind[type.kind]
          const isActive = isFile
            ? dragOverKind === type.kind
            : activeUrlKind === type.kind

          function activate() {
            if (isBusy) return
            if (isFile) {
              fileInputRefs.current[type.kind]?.click()
            } else {
              setActiveUrlKind(type.kind)
            }
          }

          return (
            <div
              key={type.kind}
              role="button"
              tabIndex={0}
              title={type.description}
              onClick={activate}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  activate()
                }
              }}
              onDragOver={
                isFile
                  ? (e) => {
                      e.preventDefault()
                      setDragOverKind(type.kind)
                    }
                  : undefined
              }
              onDragLeave={
                isFile
                  ? () => setDragOverKind((k) => (k === type.kind ? null : k))
                  : undefined
              }
              onDrop={
                isFile
                  ? (e) => {
                      e.preventDefault()
                      setDragOverKind(null)
                      handleFileList(type, e.dataTransfer.files)
                    }
                  : undefined
              }
              className={cn(
                "group flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed p-3 text-center transition-all",
                "border-foreground/15 bg-card hover:border-foreground/30 hover:bg-muted/40",
                isActive && "border-ring bg-muted/40 ring-1 ring-ring/40",
                isBusy && "pointer-events-none opacity-70"
              )}
            >
              <div className="flex size-8 items-center justify-center rounded-lg bg-foreground/5 text-foreground/70 transition-colors group-hover:text-foreground">
                {isBusy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Icon className="size-4" />
                )}
              </div>
              <p className="text-sm font-medium text-foreground">{type.title}</p>
              <p
                className={cn(
                  "text-[11px] leading-tight",
                  error ? "text-red-400" : "text-muted-foreground/70"
                )}
              >
                {error ??
                  (isBusy
                    ? "Uploading…"
                    : isFile
                      ? "Drop or click"
                      : "Click to paste link")}
              </p>
              {isFile && (
                <input
                  ref={(el) => {
                    fileInputRefs.current[type.kind] = el
                  }}
                  type="file"
                  accept={type.accept}
                  multiple
                  className="hidden"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    handleFileList(type, e.target.files)
                    e.target.value = ""
                  }}
                />
              )}
            </div>
          )
        })}
      </div>

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <Info className="size-3 shrink-0" />
        New sources process in the background — this can take anywhere from
        a few seconds to several minutes depending on how ingestion is
        deployed, so a source sitting in Queued is expected, not stuck.
      </p>

      {activeUrlType && (
        <div className="flex flex-col gap-2 rounded-xl border border-border px-4 py-4">
          <div className="flex gap-2">
            <Input
              autoFocus
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUrlSubmit()
              }}
              disabled={busyKinds.has(activeUrlType.kind)}
              placeholder={
                activeUrlType.kind === "youtube"
                  ? "https://youtube.com/watch?v=..."
                  : "https://example.com/article"
              }
            />
            <Button
              type="button"
              onClick={handleUrlSubmit}
              disabled={busyKinds.has(activeUrlType.kind)}
            >
              {busyKinds.has(activeUrlType.kind) ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Add"
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Added to the resources panel once queued — indexing runs in the background.
          </p>
        </div>
      )}
    </div>
  )
}
