import { randomUUID } from "crypto"
import { Job } from "bullmq"
import { openAIEmbed } from "@/lib/llm/providers/openai"
import { upsertChunk } from "@/lib/db/qdrant"
import { IngestChunkJobData } from "./ingest-source.processor"

export async function processIngestChunk(job: Job<IngestChunkJobData>) {
  const { resourceId, sourceType, chunkIndex, text, startTime, endTime } = job.data

  const vector = await openAIEmbed(text)
  await upsertChunk({
    id: randomUUID(),
    vector,
    payload: { sourceId: resourceId, sourceType, chunkIndex, text, startTime, endTime },
  })

  return { ok: true }
}
