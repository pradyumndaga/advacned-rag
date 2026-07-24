import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { getResource } from "@/lib/ingestion/resource-store"
import { getPdfBlobStream } from "@/lib/storage/blob"

// The Blob store is private (lib/storage/blob.ts), so the PDF is never
// reachable by a bare blob URL — every read goes through this route, which
// applies the same ownership check as every other resource endpoint before
// streaming the bytes through.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const resource = await getResource(id)
  if (!resource || resource.userId !== userId || !resource.fileUrl) {
    return NextResponse.json({ error: "resource not found" }, { status: 404 })
  }

  const blob = await getPdfBlobStream(resource.fileUrl)
  if (!blob || blob.statusCode !== 200) {
    return NextResponse.json({ error: "resource not found" }, { status: 404 })
  }

  // Sanitize before it goes into a header value — the label is just the
  // original uploaded filename, but header values can't contain quotes or
  // control characters.
  const safeName = resource.label.replace(/[\x00-\x1f"]/g, "")

  return new NextResponse(blob.stream, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${safeName}"`,
    },
  })
}
