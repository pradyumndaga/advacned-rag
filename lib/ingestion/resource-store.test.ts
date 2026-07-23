import { describe, expect, it, vi } from "vitest"
import { Resource } from "./types"

// A minimal in-memory stand-in for ioredis, implementing only the exact
// calls resource-store.ts makes (get/set/zadd/zrevrange/mget) — enough to
// exercise real state transitions without a real Redis instance.
function createFakeRedis() {
  const store = new Map<string, string>()
  const index = new Map<string, number>() // member -> score

  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async set(key: string, value: string) {
      store.set(key, value)
      return "OK"
    },
    async zadd(...args: [string, number, string]) {
      const [, score, member] = args
      index.set(member, score)
      return 1
    },
    async zrevrange(...args: [string, number, number]) {
      void args
      return [...index.entries()].sort((a, b) => b[1] - a[1]).map(([member]) => member)
    },
    async mget(keys: string[]) {
      return keys.map((k) => store.get(k) ?? null)
    },
  }
}

const fakeRedis = createFakeRedis()

vi.mock("@/lib/queue/connection", () => ({
  getRedisConnection: () => fakeRedis,
}))

import { createResource, getResource, updateResource, listResources } from "./resource-store"

function makeResource(overrides: Partial<Resource> = {}): Resource {
  const now = Date.now()
  return {
    id: overrides.id ?? "res-1",
    kind: "pdf",
    label: "Profile.pdf",
    detail: "48.3 KB",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

// fakeRedis is shared across every test in this file (vi.mock's factory
// captures it once) — each test uses its own unique resource id instead of
// resetting the store, to avoid cross-test interference.
describe("resource-store", () => {
  it("round-trips a created resource", async () => {
    const resource = makeResource({ id: "round-trip-1" })
    await createResource(resource)
    const fetched = await getResource("round-trip-1")
    expect(fetched).toEqual(resource)
  })

  it("returns null for an unknown resource id", async () => {
    expect(await getResource("does-not-exist")).toBeNull()
  })

  it("transitions a resource through its lifecycle: queued -> processing -> ready", async () => {
    const resource = makeResource({ id: "lifecycle-1", status: "queued" })
    await createResource(resource)

    const processing = await updateResource("lifecycle-1", { status: "processing" })
    expect(processing?.status).toBe("processing")
    expect(processing?.updatedAt).toBeGreaterThanOrEqual(resource.updatedAt)

    const ready = await updateResource("lifecycle-1", { status: "ready" })
    expect(ready?.status).toBe("ready")

    const fetched = await getResource("lifecycle-1")
    expect(fetched?.status).toBe("ready")
  })

  it("transitions a resource to failed with an error message, from any prior state", async () => {
    const resource = makeResource({ id: "lifecycle-2", status: "processing" })
    await createResource(resource)

    const failed = await updateResource("lifecycle-2", {
      status: "failed",
      error: "no captions available for this video",
    })
    expect(failed?.status).toBe("failed")
    expect(failed?.error).toBe("no captions available for this video")
  })

  it("returns null when updating a resource that doesn't exist", async () => {
    expect(await updateResource("never-created", { status: "ready" })).toBeNull()
  })

  it("lists resources newest-first", async () => {
    const older = makeResource({ id: "list-older", createdAt: 1000 })
    const newer = makeResource({ id: "list-newer", createdAt: 2000 })
    await createResource(older)
    await createResource(newer)

    const all = await listResources()
    const ids = all.map((r) => r.id)
    expect(ids.indexOf("list-newer")).toBeLessThan(ids.indexOf("list-older"))
  })
})
