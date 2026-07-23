import { QdrantClient } from "@qdrant/js-client-rest"
import { StoredChunk } from "@/lib/ingestion/types"

const COLLECTION = process.env.QDRANT_COLLECTION ?? "advanced-rag-chunks"
const EMBEDDING_SIZE = 1536 // text-embedding-3-small

let client: QdrantClient | null = null

function getClient(): QdrantClient {
  if (!client) {
    const url = process.env.QDRANT_DB
    const apiKey = process.env.QDRANT_API_KEY
    if (!url || !apiKey) {
      throw new Error("QDRANT_DB / QDRANT_API_KEY are not set")
    }
    client = new QdrantClient({ url, apiKey })
  }
  return client
}

let ensured = false
async function ensureCollection(): Promise<void> {
  if (ensured) return
  const c = getClient()
  const { exists } = await c.collectionExists(COLLECTION)
  if (!exists) {
    await c.createCollection(COLLECTION, {
      vectors: { size: EMBEDDING_SIZE, distance: "Cosine" },
    })
  }
  // Qdrant Cloud requires an explicit payload index before a field can be
  // used in a scroll/search filter — fetchChunksBySource filters on this.
  await c.createPayloadIndex(COLLECTION, {
    field_name: "sourceId",
    field_schema: "keyword",
  })
  ensured = true
}

export interface ChunkPoint {
  id: string
  vector: number[]
  payload: StoredChunk
}

export async function upsertChunk(point: ChunkPoint): Promise<void> {
  await ensureCollection()
  await getClient().upsert(COLLECTION, {
    points: [{ id: point.id, vector: point.vector, payload: { ...point.payload } }],
  })
}

export async function fetchChunksBySource(sourceId: string): Promise<StoredChunk[]> {
  await ensureCollection()
  const result = await getClient().scroll(COLLECTION, {
    filter: { must: [{ key: "sourceId", match: { value: sourceId } }] },
    limit: 1000,
    with_payload: true,
    with_vector: false,
  })
  return (result.points as unknown as { payload: StoredChunk }[])
    .map((p) => p.payload)
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
}
