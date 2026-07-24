import * as React from "react"
import { Captions, FileCode2, FileText, Globe, PlayCircle } from "lucide-react"
import { SourceType } from "@/lib/ingestion/types"

export const SOURCE_ICONS: Record<SourceType, React.ElementType> = {
  pdf: FileText,
  markdown: FileCode2,
  srt: Captions,
  vtt: Captions,
  youtube: PlayCircle,
  webpage: Globe,
}

export const SOURCE_LABELS: Record<SourceType, string> = {
  pdf: "PDF",
  markdown: "Markdown",
  srt: "SRT",
  vtt: "VTT",
  youtube: "YouTube",
  webpage: "Web page",
}
