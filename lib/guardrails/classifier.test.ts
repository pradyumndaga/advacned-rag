import { describe, expect, it } from "vitest"
import { parseClassifierResponse } from "./classifier"

describe("parseClassifierResponse", () => {
  it("parses an accepted verdict with a reason", () => {
    const result = parseClassifierResponse('{"verdict": "accepted", "reason": "normal chat"}')
    expect(result).toEqual({ verdict: "accepted", reason: "normal chat" })
  })

  it("parses a rejected verdict", () => {
    const result = parseClassifierResponse('{"verdict": "rejected", "reason": "prompt injection"}')
    expect(result).toEqual({ verdict: "rejected", reason: "prompt injection" })
  })

  it("defaults reason to an empty string when the model omits it", () => {
    const result = parseClassifierResponse('{"verdict": "accepted"}')
    expect(result).toEqual({ verdict: "accepted", reason: "" })
  })

  it("tolerates surrounding whitespace", () => {
    const result = parseClassifierResponse('  \n{"verdict": "accepted", "reason": "ok"}\n  ')
    expect(result?.verdict).toBe("accepted")
  })

  it("returns null for invalid JSON", () => {
    expect(parseClassifierResponse("not json at all")).toBeNull()
  })

  it("returns null when verdict is missing or invalid", () => {
    expect(parseClassifierResponse('{"reason": "ok"}')).toBeNull()
    expect(parseClassifierResponse('{"verdict": "maybe"}')).toBeNull()
  })

  it("returns null for a JSON array instead of an object", () => {
    expect(parseClassifierResponse('["accepted"]')).toBeNull()
  })
})
