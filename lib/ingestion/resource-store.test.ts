import { describe, expect, it, vi } from "vitest"
import { Resource } from "./types"

// A minimal in-memory stand-in for ioredis, implementing only the exact
// calls resource-store.ts makes (get/set/del/zadd/zrem/zrevrange/mget) —
// enough to exercise real state transitions without a real Redis instance.
// Keyed properly (unlike a single shared index) so per-user index scoping
// (resources:index:<userId>) can actually be tested.
function createFakeRedis() {
  const store = new Map<string, string>()
  const indexes = new Map<string, Map<string, number>>() // key -> (member -> score)

  function getIndex(key: string) {
    let idx = indexes.get(key)
    if (!idx) {
      idx = new Map()
      indexes.set(key, idx)
    }
    return idx
  }

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
    async zadd(key: string, score: number, member: string) {
      getIndex(key).set(member, score)
      return 1
    },
    async zrem(key: string, member: string) {
      return getIndex(key).delete(member) ? 1 : 0
    },
    async zrevrange(key: string, ...rest: [number, number]) {
      void rest
      return [...getIndex(key).entries()].sort((a, b) => b[1] - a[1]).map(([member]) => member)
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

import { createResource, deleteResource, getResource, updateResource, listResources } from "./resource-store"

function makeResource(overrides: Partial<Resource> = {}): Resource {
  const now = Date.now()
  return {
    id: overrides.id ?? "res-1",
    userId: overrides.userId ?? "user-1",
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

  it("lists a user's resources newest-first", async () => {
    const older = makeResource({ id: "list-older", createdAt: 1000, userId: "list-user-1" })
    const newer = makeResource({ id: "list-newer", createdAt: 2000, userId: "list-user-1" })
    await createResource(older)
    await createResource(newer)

    const all = await listResources("list-user-1")
    const ids = all.map((r) => r.id)
    expect(ids.indexOf("list-newer")).toBeLessThan(ids.indexOf("list-older"))
  })

  it("isolates resources between users — one user's list never includes another's", async () => {
    const mine = makeResource({ id: "isolated-mine", userId: "isolated-user-a" })
    const theirs = makeResource({ id: "isolated-theirs", userId: "isolated-user-b" })
    await createResource(mine)
    await createResource(theirs)

    const myList = await listResources("isolated-user-a")
    const theirList = await listResources("isolated-user-b")

    expect(myList.map((r) => r.id)).toEqual(["isolated-mine"])
    expect(theirList.map((r) => r.id)).toEqual(["isolated-theirs"])
  })

  it("deletes a resource: removes the record and drops it from its owner's list", async () => {
    const resource = makeResource({ id: "delete-me", userId: "delete-user" })
    const other = makeResource({ id: "keep-me", userId: "delete-user" })
    await createResource(resource)
    await createResource(other)

    await deleteResource("delete-me", "delete-user")

    expect(await getResource("delete-me")).toBeNull()
    const remaining = await listResources("delete-user")
    expect(remaining.map((r) => r.id)).toEqual(["keep-me"])
  })
})
