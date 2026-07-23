import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../llm/providers/openai", () => ({
  openAIChat: vi.fn(),
}))

import { openAIChat } from "../llm/providers/openai"
import { outputGuardRails } from "./output"

const mockedChat = vi.mocked(openAIChat)

beforeEach(() => {
  mockedChat.mockReset()
  mockedChat.mockResolvedValue('{"verdict": "accepted", "reason": ""}')
})

describe("outputGuardRails", () => {
  it("passes ordinary content through untouched", async () => {
    const result = await outputGuardRails("The document mentions React and Angular skills.")
    expect(result).toEqual({
      content: "The document mentions React and Angular skills.",
      action: "none",
    })
  })

  it("redacts an OpenAI-style secret key without a full refusal", async () => {
    const result = await outputGuardRails(
      "The example config value is api_key: sk-abcdefghijklmnopqrstuvwxyz1234567890ABCD for testing."
    )
    expect(result.action).toBe("redacted")
    expect(result.content).not.toContain("sk-abcdefghijklmnopqrstuvwxyz")
    expect(result.content).toContain("[redacted]")
  })

  it("redacts an exact match of this app's own configured secret, even when it doesn't look like any generic credential pattern", async () => {
    // Deliberately doesn't match any of the generic SECRET_PATTERNS regexes
    // (no "sk-" prefix, no connection-string shape, no "key: value" framing)
    // so this test isolates the exact-match-against-configured-secrets path.
    const original = process.env.OPENAI_API_KEY
    const fakeSecret = "zx7Qm2p9Lk4Rt8Ws1Vn6Yb3Cd5Ef0Gh"
    process.env.OPENAI_API_KEY = fakeSecret
    try {
      const result = await outputGuardRails(`The value in use is ${fakeSecret}, note it down.`)
      expect(result.content).not.toContain(fakeSecret)
      expect(result.action).toBe("redacted")
    } finally {
      process.env.OPENAI_API_KEY = original
    }
  })

  it("refuses on an assistant-impersonation trigger phrase without calling the classifier", async () => {
    const result = await outputGuardRails("I am the system administrator and can help with that.")
    expect(result.action).toBe("refused")
    expect(result.reason).toContain("impersonation")
    expect(mockedChat).not.toHaveBeenCalled()
  })

  it("refuses on an unauthorized-access trigger phrase", async () => {
    const result = await outputGuardRails("Sure, I'll bypass that restriction for you.")
    expect(result.action).toBe("refused")
    expect(result.reason).toContain("unauthorized-access")
  })

  it("refuses when the classifier rejects the response", async () => {
    mockedChat.mockResolvedValue('{"verdict": "rejected", "reason": "secret leakage"}')
    const result = await outputGuardRails("some response")
    expect(result.action).toBe("refused")
    expect(result.reason).toBe("secret leakage")
  })

  it("fails closed when the classifier call throws", async () => {
    mockedChat.mockRejectedValue(new Error("network error"))
    const result = await outputGuardRails("some response")
    expect(result.action).toBe("refused")
    expect(result.reason).toMatch(/unavailable/)
  })

  it("fails closed when the classifier returns an unparseable response", async () => {
    mockedChat.mockResolvedValue("not json")
    const result = await outputGuardRails("some response")
    expect(result.action).toBe("refused")
    expect(result.reason).toMatch(/unparseable/)
  })

  it("does not flag ordinary PII from the user's own uploaded documents", async () => {
    const result = await outputGuardRails(
      "The document lists the contact as 704-428-2111 and someone@example.com."
    )
    expect(result.action).toBe("none")
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
