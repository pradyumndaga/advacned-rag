import { RetrievedDoc, TransformedQuery } from "@/lib/types"

export interface RetrieveOptions {
  topK?: number
}

export interface RetrievalAdapter {
  name: string
  retrieve(query: TransformedQuery, opts?: RetrieveOptions): Promise<RetrievedDoc[]>
}
