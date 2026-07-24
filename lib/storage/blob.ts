import { randomUUID } from "crypto"
import { del, get, put } from "@vercel/blob"

// Private store: PDFs are user documents, not public assets, so they're
// never served from a bare blob URL — every read goes through our own
// authenticated route (app/api/resources/[id]/file/route.ts), matching the
// ownership checks the rest of the app already applies to resources.
export async function uploadPdfBlob(buffer: Buffer, fileName: string, userId: string): Promise<string> {
  const blob = await put(`pdfs/${userId}/${randomUUID()}-${fileName}`, buffer, {
    access: "private",
    contentType: "application/pdf",
  })
  return blob.url
}

export async function getPdfBlobStream(url: string) {
  return get(url, { access: "private" })
}

export async function deletePdfBlob(url: string): Promise<void> {
  await del(url)
}
