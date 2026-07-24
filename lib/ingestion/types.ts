export type SourceType =
  | "pdf"
  | "markdown"
  | "srt"
  | "vtt"
  | "youtube"
  | "webpage"
  | "docx"
  | "csv"
  | "xlsx"

export interface Cue {
  start: number
  end: number
  text: string
}

export type LoadedDocument =
  | { kind: "text"; text: string }
  | { kind: "timed"; cues: Cue[] }

export interface SourceLoaderInput {
  fileBuffer?: Buffer
  fileName?: string
  url?: string
}

export interface SourceLoader {
  type: SourceType
  load(input: SourceLoaderInput): Promise<LoadedDocument>
}

export type ResourceStatus = "queued" | "processing" | "ready" | "failed"

export interface Resource {
  id: string
  userId: string
  kind: SourceType
  label: string
  detail?: string
  status: ResourceStatus
  error?: string
  createdAt: number
  updatedAt: number
  // Original PDF bytes, uploaded to Vercel Blob at ingest time — lets the
  // preview render the real document instead of just its extracted text.
  fileUrl?: string
  // Original markdown source, kept verbatim (unlike PDF/webpage, nothing is
  // lost by keeping the full text around — it's what the chunks were sliced
  // from) so the preview can show one readable document instead of
  // fragmented chunks.
  rawText?: string
}

export interface StoredChunk {
  sourceId: string
  userId: string
  sourceType: SourceType
  chunkIndex: number
  text: string
  startTime?: number
  endTime?: number
}
