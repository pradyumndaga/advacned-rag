export type SourceType = "pdf" | "markdown" | "srt" | "vtt" | "youtube" | "webpage"

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
  kind: SourceType
  label: string
  detail?: string
  status: ResourceStatus
  error?: string
  createdAt: number
  updatedAt: number
}

export interface StoredChunk {
  sourceId: string
  sourceType: SourceType
  chunkIndex: number
  text: string
  startTime?: number
  endTime?: number
}
