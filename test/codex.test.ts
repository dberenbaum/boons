import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  getDefaultCodexDir,
  discoverSessions,
  readSessionFromFile,
  readMessagesFromFile,
  readRawContent,
} from "../src/codex"

let codexDir: string
const cwd = "/workspace/project"

beforeAll(() => {
  codexDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-codex-"))
  const sessionDir = path.join(codexDir, "sessions", "2026", "05", "29")
  fs.mkdirSync(sessionDir, { recursive: true })

  const fixture = fs.readFileSync(
    path.join(import.meta.dir, "fixtures", "sample-codex.jsonl"),
    "utf-8",
  )
  fs.writeFileSync(path.join(sessionDir, "rollout-2026-05-29T12-00-00-codex-123.jsonl"), fixture)
  fs.writeFileSync(
    path.join(sessionDir, "rollout-2026-05-29T13-00-00-codex-456.jsonl"),
    fixture
      .replace('"id":"codex-123"', '"id":"codex-456"')
      .replace("2026-05-29T12:00:00.000Z", "2026-05-29T13:00:00.000Z")
      .replace("2026-05-29T12:00:06.000Z", "2026-05-29T13:00:06.000Z"),
  )
})

afterAll(() => {
  fs.rmSync(codexDir, { recursive: true, force: true })
})

describe("getDefaultCodexDir", () => {
  test("returns CODEX_HOME when BOONS_CODEX_DIR is not set", () => {
    const origBoons = process.env.BOONS_CODEX_DIR
    const origCodexHome = process.env.CODEX_HOME
    delete process.env.BOONS_CODEX_DIR
    process.env.CODEX_HOME = "/custom/codex"
    expect(getDefaultCodexDir()).toBe("/custom/codex")
    process.env.BOONS_CODEX_DIR = origBoons
    process.env.CODEX_HOME = origCodexHome
  })

  test("BOONS_CODEX_DIR takes priority", () => {
    const origBoons = process.env.BOONS_CODEX_DIR
    const origCodexHome = process.env.CODEX_HOME
    process.env.BOONS_CODEX_DIR = "/explicit/codex"
    process.env.CODEX_HOME = "/custom/codex"
    expect(getDefaultCodexDir()).toBe("/explicit/codex")
    process.env.BOONS_CODEX_DIR = origBoons
    process.env.CODEX_HOME = origCodexHome
  })
})

describe("discoverSessions", () => {
  test("returns sessions for cwd sorted by updated descending", () => {
    const sessions = discoverSessions(codexDir, cwd)
    expect(sessions.map(s => s.id)).toEqual(["codex-456", "codex-123"])
  })

  test("returns empty array when sessions directory does not exist", () => {
    expect(discoverSessions(path.join(codexDir, "missing"), cwd)).toEqual([])
  })
})

describe("readSessionFromFile", () => {
  test("reads session info from session_meta", () => {
    const info = readSessionFromFile(codexDir, "codex-123")
    expect(info.id).toBe("codex-123")
    expect(info.title).toBe("Implement Codex support")
    expect(info.directory).toBe(cwd)
    expect(info.agent).toBe("codex-tui")
    expect(info.model).toBe("openai")
    expect(info.time.created).toBeGreaterThan(0)
    expect(info.time.updated).toBeGreaterThan(info.time.created)
  })

  test("throws on nonexistent session", () => {
    expect(() => readSessionFromFile(codexDir, "missing")).toThrow()
  })
})

describe("readMessagesFromFile", () => {
  test("returns user and assistant messages only", () => {
    const messages = readMessagesFromFile(codexDir, "codex-123")
    expect(messages.length).toBe(4)
    expect(messages.map(m => m.info.role)).toEqual(["user", "assistant", "user", "assistant"])
  })

  test("parses text parts", () => {
    const messages = readMessagesFromFile(codexDir, "codex-123")
    expect(messages[0].parts[0].text).toBe("Implement Codex support")
    expect(messages[1].parts[0].text).toBe("I will inspect the repo and add an adapter.")
  })
})

describe("readRawContent", () => {
  test("returns native JSONL content", () => {
    const raw = readRawContent(codexDir, "codex-123")
    expect(raw).toContain("session_meta")
    expect(raw).toContain("function_call")
  })
})
