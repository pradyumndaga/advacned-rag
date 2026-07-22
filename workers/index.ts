import { getRedisConnection } from "@/lib/queue/connection";
import { Worker } from "bullmq";

new Worker(
    "health-check",
    async (job) => {
        console.log("processed job", job.id, job.data);
        return { ok: true }
    },
    { connection: getRedisConnection() }
);

console.log("Worker process listening...")