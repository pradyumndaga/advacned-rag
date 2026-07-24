import { SourceLoader, SourceType } from "../types"
import { srtLoader } from "./srt"
import { vttLoader } from "./vtt"
import { markdownLoader } from "./markdown"
import { pdfLoader } from "./pdf"
import { webpageLoader } from "./webpage"
import { youtubeLoader } from "./youtube"
import { docxLoader } from "./docx"
import { csvLoader } from "./csv"
import { xlsxLoader } from "./xlsx"

const LOADERS: Record<SourceType, SourceLoader> = {
  pdf: pdfLoader,
  markdown: markdownLoader,
  srt: srtLoader,
  vtt: vttLoader,
  youtube: youtubeLoader,
  webpage: webpageLoader,
  docx: docxLoader,
  csv: csvLoader,
  xlsx: xlsxLoader,
}

export function getLoader(type: SourceType): SourceLoader {
  return LOADERS[type]
}
