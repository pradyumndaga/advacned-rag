import { extractText, getDocumentProxy } from "unpdf"
import { SourceLoader } from "../types"

export const pdfLoader: SourceLoader = {
  type: "pdf",
  async load({ fileBuffer }) {
    if (!fileBuffer) throw new Error("pdf loader requires a file")
    const pdf = await getDocumentProxy(new Uint8Array(fileBuffer))
    const { text } = await extractText(pdf, { mergePages: true })
    if (!text.trim()) throw new Error("no extractable text in PDF")
    return { kind: "text", text: text.trim() }
  },
}
