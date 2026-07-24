import { parse } from "csv-parse/sync"
import { SourceLoader } from "../types"
import { rowsToText } from "./spreadsheet"

export const csvLoader: SourceLoader = {
  type: "csv",
  async load({ fileBuffer }) {
    if (!fileBuffer) throw new Error("csv loader requires a file")
    const records: string[][] = parse(fileBuffer, { skip_empty_lines: true, relax_column_count: true })
    if (!records.length) throw new Error("csv file is empty")

    const [headers, ...rows] = records
    const text = rowsToText(headers, rows)
    if (!text.trim()) throw new Error("no data rows in this csv file")
    return { kind: "text", text }
  },
}
