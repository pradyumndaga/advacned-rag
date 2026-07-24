import { getRedisConnection } from "@/lib/queue/connection"

export const FREE_CHAT_LIMIT = 10

const countKey = (userId: string) => `usage:chatCount:${userId}`
const unlimitedKey = (userId: string) => `usage:unlimited:${userId}`

export interface ChatUsage {
  count: number
  limit: number
  unlimited: boolean
}

export async function getChatUsage(userId: string): Promise<ChatUsage> {
  const redis = getRedisConnection()
  const [countRaw, unlimitedRaw] = await Promise.all([
    redis.get(countKey(userId)),
    redis.get(unlimitedKey(userId)),
  ])
  return {
    count: countRaw ? Number(countRaw) : 0,
    limit: FREE_CHAT_LIMIT,
    unlimited: unlimitedRaw === "1",
  }
}

// Called once per chat request (specs.md/planning.md Phase 16) — every
// submitted query counts against the cap regardless of guardrail outcome,
// since what's being metered is uses of the chat interface, not just
// successful answers.
export async function incrementChatUsage(userId: string): Promise<number> {
  return getRedisConnection().incr(countKey(userId))
}

// Written by the admin dashboard (Phase 17) — reading it is Phase 16's
// concern (bypass the cap), setting it is Phase 17's.
export async function setUnlimited(userId: string, unlimited: boolean): Promise<void> {
  const redis = getRedisConnection()
  if (unlimited) {
    await redis.set(unlimitedKey(userId), "1")
  } else {
    await redis.del(unlimitedKey(userId))
  }
}
