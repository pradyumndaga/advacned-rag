import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export const healthCheckQueue = new Queue("health-check", {
    connection: getRedisConnection()
})

// Parent job per source: runs the loader + chunker, then fans out one child
// job per chunk onto ingestChunkQueue (see specs.md §2.4 / §5).
export const ingestSourceQueue = new Queue("ingest-source", {
    connection: getRedisConnection()
})

// One job per chunk: embed + upsert into Qdrant. Retried independently so a
// single bad chunk doesn't lose the whole document.
export const ingestChunkQueue = new Queue("ingest-chunk", {
    connection: getRedisConnection()
})