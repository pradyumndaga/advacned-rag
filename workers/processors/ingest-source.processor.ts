import { Job, WaitingChildrenError } from "bullmq"
import { getLoader } from "@/lib/ingestion/loaders"
import { chunkText } from "@/lib/ingestion/chunkers/token-budget"
import { chunkTimedCues } from "@/lib/ingestion/chunkers/time-window"
import { updateResource } from "@/lib/ingestion/resource-store"
import { ingestChunkQueue } from "@/lib/queue/queues"
import { SourceType } from "@/lib/ingestion/types"

export interface IngestSourceJobData {
  resourceId: string
  sourceType: SourceType
  fileBase64?: string
  fileName?: string
  url?: string
  chunksQueued?: boolean
}

export interface IngestChunkJobData {
  resourceId: string
  sourceType: SourceType
  chunkIndex: number
  text: string
  startTime?: number
  endTime?: number
}

// Parent job: load -> chunk -> fan out one child job per chunk, then park
// itself in "waiting-children" until every child (embed + upsert) finishes.
// This is the actual reason ingestion uses BullMQ (specs.md §2.4/§5) — each
// chunk gets independent retries instead of losing the whole document over
// one bad embed call.
export async function processIngestSource(job: Job<IngestSourceJobData>, token?: string) {
  const { resourceId, sourceType, fileBase64, fileName, url, chunksQueued } = job.data

  if (!chunksQueued) {
    await updateResource(resourceId, { status: "processing" })

    const loader = getLoader(sourceType)
    const loaded = await loader.load({
      fileBuffer: fileBase64 ? Buffer.from(fileBase64, "base64") : undefined,
      fileName,
      url,
    })

    const chunks =
      loaded.kind === "text"
        ? chunkText(loaded.text).map((c, i) => ({ ...c, chunkIndex: i, startTime: undefined, endTime: undefined }))
        : chunkTimedCues(loaded.cues).map((c, i) => ({ ...c, chunkIndex: i }))

    if (!chunks.length) {
      throw new Error("no content extracted from source")
    }

    for (const chunk of chunks) {
      const data: IngestChunkJobData = {
        resourceId,
        sourceType,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        startTime: chunk.startTime,
        endTime: chunk.endTime,
      }
      await ingestChunkQueue.add("embed-upsert", data, {
        parent: { id: job.id!, queue: job.queueQualifiedName },
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
      })
    }

    await job.updateData({ ...job.data, chunksQueued: true })
  }

  const stillHasChildren = await job.moveToWaitingChildren(token!)
  if (stillHasChildren) {
    throw new WaitingChildrenError()
  }

  await updateResource(resourceId, { status: "ready" })
  return { ok: true }
}
