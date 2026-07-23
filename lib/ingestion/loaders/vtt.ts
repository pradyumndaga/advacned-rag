import { SourceLoader } from "../types"
import { parseCues } from "./cues"

export const vttLoader: SourceLoader = {
  type: "vtt",
  async load({ fileBuffer }) {
    if (!fileBuffer) throw new Error("vtt loader requires a file")
    const cues = parseCues(fileBuffer.toString("utf-8"))
    if (!cues.length) throw new Error("no cues found in VTT file")
    return { kind: "timed", cues }
  },
}
