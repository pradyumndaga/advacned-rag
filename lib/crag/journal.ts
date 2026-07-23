export interface CragJournalEntry {
  attempt: number
  score: number
  whatWentWrong: string // mini-model diagnosis
  fixApplied: string // e.g. "re-ran retrieval with keyword feedback: [...]"
  keywordsUsed: string[]
}
