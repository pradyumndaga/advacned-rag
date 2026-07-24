import { getRedisConnection } from "@/lib/queue/connection";
import { Queue, Worker } from "bullmq";
import { processIngestSource } from "./processors/ingest-source.processor";
import { processIngestChunk } from "./processors/ingest-chunk.processor";
import { updateResource } from "@/lib/ingestion/resource-store";

// One-shot variant of workers/index.ts for environments that can't host a
// long-running process — e.g. a GitHub Actions scheduled workflow standing
// in for a real always-on worker (see README "Deploying"). Processes
// whatever's currently queued across ingest-source/ingest-chunk, then exits
// once both have gone idle for a bit, instead of listening forever.

const IDLE_EXIT_MS = 15_000;
const HARD_TIMEOUT_MS = 4 * 60 * 1000; // leaves margin before the next 5-min scheduled run

async function main() {
  const connection = getRedisConnection();

  // Cheap upfront check — most 5-minute windows will have nothing queued,
  // so avoid spinning up Workers at all in that case.
  const sourceQueue = new Queue("ingest-source", { connection });
  const chunkQueue = new Queue("ingest-chunk", { connection });
  const [sourceCounts, chunkCounts] = await Promise.all([
    sourceQueue.getJobCounts("waiting", "active", "delayed"),
    chunkQueue.getJobCounts("waiting", "active", "delayed"),
  ]);
  await Promise.all([sourceQueue.close(), chunkQueue.close()]);

  const pending =
    Object.values(sourceCounts).reduce((a, b) => a + b, 0) +
    Object.values(chunkCounts).reduce((a, b) => a + b, 0);

  if (pending === 0) {
    console.log("Nothing queued, exiting.");
    process.exit(0);
  }

  console.log(`${pending} job(s) queued, starting drain...`);

  let lastActivity = Date.now();
  const touch = () => {
    lastActivity = Date.now();
  };

  const sourceWorker = new Worker("ingest-source", processIngestSource, {
    connection,
    concurrency: 2,
  });
  const chunkWorker = new Worker("ingest-chunk", processIngestChunk, {
    connection,
    concurrency: 4,
  });

  sourceWorker.on("active", touch);
  sourceWorker.on("completed", touch);
  sourceWorker.on("failed", async (job) => {
    touch();
    if (!job) return;
    console.error("ingest-source job failed", job.id, job.failedReason);
    await updateResource(job.data.resourceId, {
      status: "failed",
      error: job.failedReason ?? "ingestion failed",
    });
  });

  chunkWorker.on("active", touch);
  chunkWorker.on("completed", touch);
  chunkWorker.on("failed", async (job) => {
    touch();
    if (!job) return;
    console.error("ingest-chunk job failed", job.id, job.failedReason);
    const attemptsExhausted = job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!attemptsExhausted) return; // still has retries left, let it try again
    await updateResource(job.data.resourceId, {
      status: "failed",
      error: `chunk ${job.data.chunkIndex} failed: ${job.failedReason ?? "embedding error"}`,
    });
  });

  const startedAt = Date.now();
  await new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      const idleFor = Date.now() - lastActivity;
      const runningFor = Date.now() - startedAt;
      if (idleFor >= IDLE_EXIT_MS || runningFor >= HARD_TIMEOUT_MS) {
        clearInterval(interval);
        resolve();
      }
    }, 1000);
  });

  console.log("Drain complete, closing workers.");
  await Promise.all([sourceWorker.close(), chunkWorker.close()]);
  process.exit(0);
}

main().catch((err) => {
  console.error("drain script failed:", err);
  process.exit(1);
});
