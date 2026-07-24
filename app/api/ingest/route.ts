import { randomUUID } from "crypto"
import { NextResponse } from "next/server"
import { auth } from "@clerk/nextjs/server"
import { createResource } from "@/lib/ingestion/resource-store"
import { ingestSourceQueue } from "@/lib/queue/queues"
import { SourceType } from "@/lib/ingestion/types"

const MAX_FILE_BYTES = 20 * 1024 * 1024 // 20 MB

const FILE_KINDS = new Set(["pdf", "markdown", "subtitles"])
const URL_KINDS = new Set(["youtube", "webpage"])

function inferSubtitleType(fileName: string): "srt" | "vtt" {
  return /\.vtt$/i.test(fileName) ? "vtt" : "srt"
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export async function POST(request: Request) {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const contentType = request.headers.get("content-type") ?? ""

  let sourceType: SourceType
  let label: string
  let detail: string | undefined
  let fileBase64: string | undefined
  let fileName: string | undefined
  let url: string | undefined

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData()
    const file = form.get("file")
    const kind = form.get("kind")

    if (!(file instanceof File) || typeof kind !== "string" || !FILE_KINDS.has(kind)) {
      return NextResponse.json({ error: "a file and a valid kind are required" }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "file too large (max 20 MB)" }, { status: 400 })
    }

    sourceType = kind === "subtitles" ? inferSubtitleType(file.name) : (kind as SourceType)
    fileName = file.name
    label = file.name
    detail = formatSize(file.size)
    fileBase64 = Buffer.from(await file.arrayBuffer()).toString("base64")
  } else {
    const body = await request.json().catch(() => null)
    if (
      !body ||
      typeof body.url !== "string" ||
      !body.url.trim() ||
      typeof body.kind !== "string" ||
      !URL_KINDS.has(body.kind)
    ) {
      return NextResponse.json({ error: "a url and a valid kind are required" }, { status: 400 })
    }

    sourceType = body.kind as SourceType
    const trimmedUrl: string = body.url.trim()
    url = trimmedUrl
    label = trimmedUrl
    detail = sourceType === "youtube" ? "YouTube" : "Web page"
  }

  const resourceId = randomUUID()
  const now = Date.now()

  await createResource({
    id: resourceId,
    kind: sourceType,
    label,
    detail,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  })

  await ingestSourceQueue.add("ingest", {
    resourceId,
    sourceType,
    fileBase64,
    fileName,
    url,
  })

  return NextResponse.json({
    id: resourceId,
    kind: sourceType,
    label,
    detail,
    status: "queued",
  })
}
