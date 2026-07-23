import { YoutubeTranscript } from "youtube-transcript"
import { SourceLoader } from "../types"

export const youtubeLoader: SourceLoader = {
  type: "youtube",
  async load({ url }) {
    if (!url) throw new Error("youtube loader requires a url")

    let items
    try {
      items = await YoutubeTranscript.fetchTranscript(url)
    } catch (err) {
      throw new Error(
        `could not fetch captions: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    if (!items.length) throw new Error("no captions available for this video")

    const cues = items
      .map((item) => ({
        start: item.offset / 1000,
        end: (item.offset + item.duration) / 1000,
        text: item.text.trim(),
      }))
      .filter((cue) => cue.text)

    if (!cues.length) throw new Error("captions were empty after cleanup")

    return { kind: "timed", cues }
  },
}
