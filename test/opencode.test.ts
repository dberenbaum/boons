import { test, expect, describe } from "bun:test"
import { getDefaultDBPath } from "../src/opencode"

describe("getDefaultDBPath", () => {
  test("returns default path when env var is not set", () => {
    delete process.env.BOONS_DB_PATH
    const result = getDefaultDBPath()
    expect(result).toContain(".local/share/opencode/opencode.db")
  })

  test("returns env var when BOONS_DB_PATH is set", () => {
    const orig = process.env.BOONS_DB_PATH
    process.env.BOONS_DB_PATH = "/custom/path/db.sqlite"
    const result = getDefaultDBPath()
    expect(result).toBe("/custom/path/db.sqlite")
    process.env.BOONS_DB_PATH = orig
  })

  test("returns empty string when env var is empty", () => {
    const orig = process.env.BOONS_DB_PATH
    process.env.BOONS_DB_PATH = ""
    const result = getDefaultDBPath()
    expect(result).toBe("")
    process.env.BOONS_DB_PATH = orig
  })
})
