import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { getResource } from "@/lib/ingestion/resource-store"
import { fetchChunksBySource } from "@/lib/db/qdrant"

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
  if (!resource) {
    return NextResponse.json({ error: "resource not found" }, { status: 404 })
  }

  if (resource.status !== "ready") {
    return NextResponse.json({ resource, chunks: [] })
  }

  const chunks = await fetchChunksBySource(id)
  return NextResponse.json({ resource, chunks })
}
