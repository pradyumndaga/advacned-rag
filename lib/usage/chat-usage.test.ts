import { describe, expect, it, vi } from "vitest"

// A minimal in-memory stand-in for ioredis, implementing only the exact
// calls chat-usage.ts makes (get/set/del/incr).
function createFakeRedis() {
  const store = new Map<string, string>()

  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async set(key: string, value: string) {
      store.set(key, value)
      return "OK"
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0
    },
    async incr(key: string) {
      const next = (Number(store.get(key)) || 0) + 1
      store.set(key, String(next))
      return next
    },
  }
}

const fakeRedis = createFakeRedis()

vi.mock("@/lib/queue/connection", () => ({
  getRedisConnection: () => fakeRedis,
}))

import { FREE_CHAT_LIMIT, getChatUsage, incrementChatUsage, setUnlimited } from "./chat-usage"

describe("chat-usage", () => {
  it("starts a new user at zero, under the free limit, not unlimited", async () => {
    const usage = await getChatUsage("usage-user-1")
    expect(usage).toEqual({ count: 0, limit: FREE_CHAT_LIMIT, unlimited: false })
  })

  it("increments the counter on each call and reflects it in getChatUsage", async () => {
    await incrementChatUsage("usage-user-2")
    await incrementChatUsage("usage-user-2")
    const usage = await getChatUsage("usage-user-2")
    expect(usage.count).toBe(2)
  })

  it("does not leak count between users", async () => {
    await incrementChatUsage("usage-user-3")
    const other = await getChatUsage("usage-user-4")
    expect(other.count).toBe(0)
  })

  it("marks a user unlimited, then reverses it", async () => {
    await setUnlimited("usage-user-5", true)
    expect((await getChatUsage("usage-user-5")).unlimited).toBe(true)

    await setUnlimited("usage-user-5", false)
    expect((await getChatUsage("usage-user-5")).unlimited).toBe(false)
  })
})
