import { RetrievedDoc, TransformedQuery } from "@/lib/types"

export interface RetrieveOptions {
  userId: string
  topK?: number
}

export interface RetrievalAdapter {
  name: string
  retrieve(query: TransformedQuery, opts: RetrieveOptions): Promise<RetrievedDoc[]>
}
