import { getRedisConnection } from "@/lib/queue/connection"
import { Resource } from "./types"

const KEY_PREFIX = "resource:"
const INDEX_KEY = "resources:index"

export async function createResource(resource: Resource): Promise<void> {
  const redis = getRedisConnection()
  await redis.set(KEY_PREFIX + resource.id, JSON.stringify(resource))
  await redis.zadd(INDEX_KEY, resource.createdAt, resource.id)
}

export async function getResource(id: string): Promise<Resource | null> {
  const raw = await getRedisConnection().get(KEY_PREFIX + id)
  return raw ? (JSON.parse(raw) as Resource) : null
}

export async function updateResource(
  id: string,
  patch: Partial<Omit<Resource, "id">>
): Promise<Resource | null> {
  const existing = await getResource(id)
  if (!existing) return null
  const updated: Resource = { ...existing, ...patch, updatedAt: Date.now() }
  await getRedisConnection().set(KEY_PREFIX + id, JSON.stringify(updated))
  return updated
}

export async function listResources(): Promise<Resource[]> {
  const redis = getRedisConnection()
  const ids = await redis.zrevrange(INDEX_KEY, 0, -1)
  if (!ids.length) return []
  const raw = await redis.mget(ids.map((id) => KEY_PREFIX + id))
  return raw.filter((entry): entry is string => Boolean(entry)).map((entry) => JSON.parse(entry) as Resource)
}
