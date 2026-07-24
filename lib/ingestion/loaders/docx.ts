import mammoth from "mammoth"
import { SourceLoader } from "../types"

export const docxLoader: SourceLoader = {
  type: "docx",
  async load({ fileBuffer }) {
    if (!fileBuffer) throw new Error("docx loader requires a file")
    const { value: text } = await mammoth.extractRawText({ buffer: fileBuffer })
    if (!text.trim()) throw new Error("no extractable text in this docx file")
    return { kind: "text", text: text.trim() }
  },
}
