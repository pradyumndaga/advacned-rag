import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { deleteResource, getResource } from "@/lib/ingestion/resource-store"
import { deleteChunksBySource, fetchChunksBySource } from "@/lib/db/qdrant"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const resource = await getResource(id)
  // Same 404 for "doesn't exist" and "exists but belongs to someone else" —
  // don't give an unauthorized caller a way to distinguish the two.
  if (!resource || resource.userId !== userId) {
    return NextResponse.json({ error: "resource not found" }, { status: 404 })
  }

  if (resource.status !== "ready") {
    return NextResponse.json({ resource, chunks: [] })
  }

  const chunks = await fetchChunksBySource(id, userId)
  return NextResponse.json({ resource, chunks })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const resource = await getResource(id)
  if (!resource || resource.userId !== userId) {
    return NextResponse.json({ error: "resource not found" }, { status: 404 })
  }

  await deleteChunksBySource(id, userId)
  await deleteResource(id, userId)

  return NextResponse.json({ success: true })
}
