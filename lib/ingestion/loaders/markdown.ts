import { SourceLoader } from "../types"

export const markdownLoader: SourceLoader = {
  type: "markdown",
  async load({ fileBuffer }) {
    if (!fileBuffer) throw new Error("markdown loader requires a file")
    const text = fileBuffer.toString("utf-8").trim()
    if (!text) throw new Error("markdown file is empty")
    return { kind: "text", text }
  },
}
