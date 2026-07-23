import { getRedisConnection } from "@/lib/queue/connection";
import { Worker } from "bullmq";
import { processIngestSource } from "./processors/ingest-source.processor";
import { processIngestChunk } from "./processors/ingest-chunk.processor";
import { updateResource } from "@/lib/ingestion/resource-store";

new Worker(
    "health-check",
    async (job) => {
        console.log("processed job", job.id, job.data);
        return { ok: true }
    },
    { connection: getRedisConnection() }
);

const ingestSourceWorker = new Worker(
    "ingest-source",
    processIngestSource,
    { connection: getRedisConnection(), concurrency: 2 }
);

ingestSourceWorker.on("failed", async (job) => {
    if (!job) return;
    console.error("ingest-source job failed", job.id, job.failedReason);
    await updateResource(job.data.resourceId, {
        status: "failed",
        error: job.failedReason ?? "ingestion failed",
    });
});

const ingestChunkWorker = new Worker(
    "ingest-chunk",
    processIngestChunk,
    { connection: getRedisConnection(), concurrency: 4 }
);

ingestChunkWorker.on("failed", async (job) => {
    if (!job) return;
    console.error("ingest-chunk job failed", job.id, job.failedReason);
    const attemptsExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!attemptsExhausted) return; // still has retries left, let it try again
    await updateResource(job.data.resourceId, {
        status: "failed",
        error: `chunk ${job.data.chunkIndex} failed: ${job.failedReason ?? "embedding error"}`,
    });
});

console.log("Worker process listening...")
