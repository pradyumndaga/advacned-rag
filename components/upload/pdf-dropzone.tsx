"use client"

import * as React from "react"
import { FileText, Upload, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export interface UploadedFile {
  id: string
  name: string
  size: number
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface PdfDropzoneProps {
  files: UploadedFile[]
  onFilesAdded: (files: File[]) => void
  onFileRemoved: (id: string) => void
}

export function PdfDropzone({
  files,
  onFilesAdded,
  onFileRemoved,
}: PdfDropzoneProps) {
  const [isDragging, setIsDragging] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  function handleFileList(fileList: FileList | null) {
    if (!fileList) return
    const pdfs = Array.from(fileList).filter(
      (file) => file.type === "application/pdf"
    )
    if (pdfs.length > 0) onFilesAdded(pdfs)
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click()
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setIsDragging(false)
          handleFileList(e.dataTransfer.files)
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-8 text-center transition-colors",
          "hover:border-ring hover:bg-muted/50",
          isDragging && "border-ring bg-muted/50"
        )}
      >
        <div className="flex size-10 items-center justify-center rounded-full bg-muted">
          <Upload className="size-5 text-muted-foreground" />
        </div>
        <div className="text-sm">
          <span className="font-medium">Drag & drop PDFs here</span>
          <span className="text-muted-foreground"> or click to browse</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Files are added to the RAG index — not sent anywhere yet.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            handleFileList(e.target.files)
            e.target.value = ""
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {files.map((file) => (
            <Badge
              key={file.id}
              variant="secondary"
              className="h-7 gap-1.5 rounded-lg px-2.5 text-xs"
            >
              <FileText data-icon="inline-start" className="size-3.5" />
              <span className="max-w-40 truncate">{file.name}</span>
              <span className="text-muted-foreground">
                {formatSize(file.size)}
              </span>
              <Tooltip>
                <TooltipTrigger
                  onClick={(e) => {
                    e.stopPropagation()
                    onFileRemoved(file.id)
                  }}
                  className="ml-0.5 rounded-full p-0.5 hover:bg-foreground/10"
                >
                  <X className="size-3" />
                </TooltipTrigger>
                <TooltipContent>Remove file</TooltipContent>
              </Tooltip>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
