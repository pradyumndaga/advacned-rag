import { describe, expect, it } from "vitest"
import { routeQuery } from "./route-adaptor"
import { TransformedQuery } from "@/lib/types"

describe("routeQuery", () => {
  it("always routes to the vector adapter (only one implemented so far)", () => {
    const query: TransformedQuery = { type: "rewrite", text: "anything" }
    expect(routeQuery(query)).toEqual(["vector"])
  })

  it("routes every transformed query type to vector, since no classification exists yet", () => {
    const types: TransformedQuery["type"][] = ["stepback", "rewrite", "subquestion", "hyde", "keyword-feedback"]
    for (const type of types) {
      expect(routeQuery({ type, text: "x" })).toEqual(["vector"])
    }
  })
})
