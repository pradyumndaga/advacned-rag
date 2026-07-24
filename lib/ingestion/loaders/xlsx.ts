import ExcelJS from "exceljs"
import { SourceLoader } from "../types"
import { rowsToText } from "./spreadsheet"

export const xlsxLoader: SourceLoader = {
  type: "xlsx",
  async load({ fileBuffer }) {
    if (!fileBuffer) throw new Error("xlsx loader requires a file")

    const workbook = new ExcelJS.Workbook()
    // exceljs's bundled types predate Node's Buffer becoming generic over
    // ArrayBufferLike — a real typings mismatch, not a behavioral one.
    await workbook.xlsx.load(fileBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0])

    // Multi-sheet workbooks become multiple labeled sections in one
    // document — chunking then splits across sheet boundaries same as it
    // would across paragraphs in any other text source.
    const sections: string[] = []
    workbook.eachSheet((sheet) => {
      const rows: string[][] = []
      sheet.eachRow((row) => {
        const values = Array.isArray(row.values) ? row.values : []
        // ExcelJS rows are 1-indexed with index 0 unused — drop it.
        rows.push(values.slice(1).map((cell) => (cell == null ? "" : String(cell))))
      })
      if (!rows.length) return

      const [headers, ...dataRows] = rows
      const text = rowsToText(headers, dataRows)
      if (text.trim()) sections.push(`Sheet: ${sheet.name}\n${text}`)
    })

    if (!sections.length) throw new Error("no data found in this spreadsheet")
    return { kind: "text", text: sections.join("\n\n") }
  },
}
