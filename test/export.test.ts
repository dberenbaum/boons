import { test, expect, describe } from "bun:test"
import { isKnownTool, validTools } from "../src/export"

describe("isKnownTool", () => {
  test("returns true for known tools", () => {
    expect(isKnownTool("opencode")).toBe(true)
    expect(isKnownTool("claude-code")).toBe(true)
    expect(isKnownTool("cursor")).toBe(true)
    expect(isKnownTool("codex")).toBe(true)
  })

  test("returns false for unknown tools", () => {
    expect(isKnownTool("vscode")).toBe(false)
    expect(isKnownTool("")).toBe(false)
    expect(isKnownTool("")).toBe(false)
  })
})

describe("validTools", () => {
  test("returns all known tools", () => {
    const tools = validTools()
    expect(tools).toEqual(["opencode", "claude-code", "cursor", "codex"])
  })
})
