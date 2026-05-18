import { test, expect, describe } from "bun:test"
import { getDefaultDBPath } from "../src/opencode"

describe("getDefaultDBPath", () => {
  test("returns default path when env vars are not set", () => {
    const origDB = process.env.BOONS_DB_PATH
    const origXDG = process.env.XDG_DATA_HOME
    delete process.env.BOONS_DB_PATH
    delete process.env.XDG_DATA_HOME
    const result = getDefaultDBPath()
    expect(result).toContain(".local/share/opencode/opencode.db")
    process.env.BOONS_DB_PATH = origDB
    process.env.XDG_DATA_HOME = origXDG
  })

  test("respects XDG_DATA_HOME when BOONS_DB_PATH is not set", () => {
    const origDB = process.env.BOONS_DB_PATH
    const origXDG = process.env.XDG_DATA_HOME
    delete process.env.BOONS_DB_PATH
    process.env.XDG_DATA_HOME = "/custom/data"
    const result = getDefaultDBPath()
    expect(result).toBe("/custom/data/opencode/opencode.db")
    process.env.BOONS_DB_PATH = origDB
    process.env.XDG_DATA_HOME = origXDG
  })

  test("BOONS_DB_PATH takes priority over XDG_DATA_HOME", () => {
    const origDB = process.env.BOONS_DB_PATH
    const origXDG = process.env.XDG_DATA_HOME
    process.env.BOONS_DB_PATH = "/explicit/path.db"
    process.env.XDG_DATA_HOME = "/custom/data"
    const result = getDefaultDBPath()
    expect(result).toBe("/explicit/path.db")
    process.env.BOONS_DB_PATH = origDB
    process.env.XDG_DATA_HOME = origXDG
  })

  test("returns env var when BOONS_DB_PATH is set", () => {
    const orig = process.env.BOONS_DB_PATH
    process.env.BOONS_DB_PATH = "/custom/path/db.sqlite"
    const result = getDefaultDBPath()
    expect(result).toBe("/custom/path/db.sqlite")
    process.env.BOONS_DB_PATH = orig
  })

  test("empty BOONS_DB_PATH falls back to XDG default", () => {
    const origDB = process.env.BOONS_DB_PATH
    const origXDG = process.env.XDG_DATA_HOME
    process.env.BOONS_DB_PATH = ""
    delete process.env.XDG_DATA_HOME
    const result = getDefaultDBPath()
    expect(result).toContain(".local/share/opencode/opencode.db")
    process.env.BOONS_DB_PATH = origDB
    process.env.XDG_DATA_HOME = origXDG
  })
})
