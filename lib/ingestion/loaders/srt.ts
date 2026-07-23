import { SourceLoader } from "../types"
import { parseCues } from "./cues"

export const srtLoader: SourceLoader = {
  type: "srt",
  async load({ fileBuffer }) {
    if (!fileBuffer) throw new Error("srt loader requires a file")
    const cues = parseCues(fileBuffer.toString("utf-8"))
    if (!cues.length) throw new Error("no cues found in SRT file")
    return { kind: "timed", cues }
  },
}
