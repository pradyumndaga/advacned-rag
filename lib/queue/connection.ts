import { config } from "dotenv";
import { Redis } from "ioredis";

// Next.js auto-loads .env.local for API routes, but the standalone worker
// process (run via `tsx`, not Next) doesn't get that for free — load it
// explicitly here so both entrypoints see the same REDIS_URL.
config({ path: ".env.local" });

let connection: Redis | null = null;

export function getRedisConnection(): Redis {
    if (!connection) {
        connection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
            maxRetriesPerRequest: null,
        })
    }
    return connection;
}