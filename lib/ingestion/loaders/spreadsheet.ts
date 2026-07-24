// Shared by csv.ts and xlsx.ts (same reasoning as cues.ts for srt/vtt):
// tabular data reads better to an embedder/LLM as "Header: value" sentences
// per row than as a raw grid, and this is the one piece of that logic both
// loaders need — parsing the file itself still differs per format.
export function rowsToText(headers: string[], rows: string[][]): string {
  return rows
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => headers.map((header, i) => `${header}: ${row[i] ?? ""}`).join(", "))
    .join("\n")
}
