import { test, expect, describe } from "bun:test"
import { getDefaultDBPath } from "../src/opencode"

describe("getDefaultDBPath", () => {
  test("returns default path when env vars are not set", () => {
    const origDir = process.env.BOONS_OPENCODE_DIR
    const origXDG = process.env.XDG_DATA_HOME
    delete process.env.BOONS_OPENCODE_DIR
    delete process.env.XDG_DATA_HOME
    const result = getDefaultDBPath()
    expect(result).toContain(".local/share/opencode/opencode.db")
    process.env.BOONS_OPENCODE_DIR = origDir
    process.env.XDG_DATA_HOME = origXDG
  })

  test("respects XDG_DATA_HOME when BOONS_OPENCODE_DIR is not set", () => {
    const origDir = process.env.BOONS_OPENCODE_DIR
    const origXDG = process.env.XDG_DATA_HOME
    delete process.env.BOONS_OPENCODE_DIR
    process.env.XDG_DATA_HOME = "/custom/data"
    const result = getDefaultDBPath()
    expect(result).toBe("/custom/data/opencode/opencode.db")
    process.env.BOONS_OPENCODE_DIR = origDir
    process.env.XDG_DATA_HOME = origXDG
  })

  test("BOONS_OPENCODE_DIR takes priority over XDG_DATA_HOME", () => {
    const origDir = process.env.BOONS_OPENCODE_DIR
    const origXDG = process.env.XDG_DATA_HOME
    process.env.BOONS_OPENCODE_DIR = "/explicit/data"
    process.env.XDG_DATA_HOME = "/custom/data"
    const result = getDefaultDBPath()
    expect(result).toBe("/explicit/data/opencode.db")
    process.env.BOONS_OPENCODE_DIR = origDir
    process.env.XDG_DATA_HOME = origXDG
  })

  test("returns env var when BOONS_OPENCODE_DIR is set", () => {
    const orig = process.env.BOONS_OPENCODE_DIR
    process.env.BOONS_OPENCODE_DIR = "/custom/path"
    const result = getDefaultDBPath()
    expect(result).toBe("/custom/path/opencode.db")
    process.env.BOONS_OPENCODE_DIR = orig
  })

  test("empty BOONS_OPENCODE_DIR falls back to XDG default", () => {
    const origDir = process.env.BOONS_OPENCODE_DIR
    const origXDG = process.env.XDG_DATA_HOME
    process.env.BOONS_OPENCODE_DIR = ""
    delete process.env.XDG_DATA_HOME
    const result = getDefaultDBPath()
    expect(result).toContain(".local/share/opencode/opencode.db")
    process.env.BOONS_OPENCODE_DIR = origDir
    process.env.XDG_DATA_HOME = origXDG
  })
})
