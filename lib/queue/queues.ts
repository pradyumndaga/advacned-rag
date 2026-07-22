import { Queue } from "bullmq";
import { getRedisConnection } from "./connection";

export const healthCheckQueue = new Queue("health-check", {
    connection: getRedisConnection()
})