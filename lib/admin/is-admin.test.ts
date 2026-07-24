import { afterEach, describe, expect, it, vi } from "vitest"
import { isAdminEmail } from "./is-admin"

describe("isAdminEmail", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("matches an email in the allowlist", () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com")
    expect(isAdminEmail("admin@example.com")).toBe(true)
  })

  it("is case-insensitive", () => {
    vi.stubEnv("ADMIN_EMAILS", "Admin@Example.com")
    expect(isAdminEmail("admin@example.com")).toBe(true)
  })

  it("supports multiple comma-separated emails with surrounding whitespace", () => {
    vi.stubEnv("ADMIN_EMAILS", "one@example.com, two@example.com , three@example.com")
    expect(isAdminEmail("two@example.com")).toBe(true)
  })

  it("rejects an email not on the allowlist", () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com")
    expect(isAdminEmail("someone-else@example.com")).toBe(false)
  })

  it("rejects when the allowlist is unset", () => {
    vi.stubEnv("ADMIN_EMAILS", "")
    expect(isAdminEmail("admin@example.com")).toBe(false)
  })

  it("rejects a null or undefined email", () => {
    vi.stubEnv("ADMIN_EMAILS", "admin@example.com")
    expect(isAdminEmail(null)).toBe(false)
    expect(isAdminEmail(undefined)).toBe(false)
  })
})
