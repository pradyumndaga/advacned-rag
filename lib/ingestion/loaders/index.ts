import { SourceLoader, SourceType } from "../types"
import { srtLoader } from "./srt"
import { vttLoader } from "./vtt"
import { markdownLoader } from "./markdown"
import { pdfLoader } from "./pdf"
import { webpageLoader } from "./webpage"
import { youtubeLoader } from "./youtube"

const LOADERS: Record<SourceType, SourceLoader> = {
  pdf: pdfLoader,
  markdown: markdownLoader,
  srt: srtLoader,
  vtt: vttLoader,
  youtube: youtubeLoader,
  webpage: webpageLoader,
}

export function getLoader(type: SourceType): SourceLoader {
  return LOADERS[type]
}
