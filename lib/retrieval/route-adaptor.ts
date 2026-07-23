import { TransformedQuery } from "@/lib/types"

export type AdapterTarget = "vector" | "keyword" | "sql" | "graph"

// Heuristic-only for now, no mini-LLM call — keyword/SQL/graph adapters
// don't exist yet (specs.md §4.4), so classifying between four destinations
// when three don't resolve to anything would be pure overhead with no
// observable difference in behavior. Same reasoning this project already
// applied to reverting BullMQ on query-transform (specs.md §5): only add
// the complexity a stage actually benefits from right now. Revisit once a
// second adapter is real and there's an actual decision to make.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- query param kept for the real signature; unused until a second adapter exists to route between
export function routeQuery(query: TransformedQuery): AdapterTarget[] {
  return ["vector"]
}
