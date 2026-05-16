import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  encodeProjectPath,
  discoverSessions,
  readSessionFromFile,
  readMessagesFromFile,
  readRawContent,
} from "../src/claude"

let projectsDir: string
let cwd: string

beforeAll(() => {
  projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-claude-projects-"))
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "boons-claude-cwd-"))

  // Create a project directory with JSONL files
  const projectDir = path.join(projectsDir, encodeProjectPath(cwd))
  fs.mkdirSync(projectDir, { recursive: true })

  // Copy sample fixture
  const fixtureContent = fs.readFileSync(
    path.join(import.meta.dir, "fixtures", "sample-claude.jsonl"),
    "utf-8",
  )
  fs.writeFileSync(path.join(projectDir, "sess-123.jsonl"), fixtureContent)

  // Create a second JSONL file with different content
  const lines = fixtureContent.trim().split("\n")
  fs.writeFileSync(path.join(projectDir, "sess-456.jsonl"), lines.slice(0, 2).join("\n") + "\n")
})

afterAll(() => {
  fs.rmSync(projectsDir, { recursive: true, force: true })
  fs.rmSync(cwd, { recursive: true, force: true })
})

describe("encodeProjectPath", () => {
  test("encodes simple path", () => {
    expect(encodeProjectPath("/home/user/project")).toBe("-home-user-project")
  })

  test("encodes path with numbers and dots", () => {
    expect(encodeProjectPath("/opt/my_app/v2.0/test")).toBe("-opt-my_app-v2.0-test")
  })

  test("encodes root path", () => {
    expect(encodeProjectPath("/")).toBe("-")
  })
})

describe("discoverSessions", () => {
  test("returns sessions sorted by mtime descending", () => {
    const sessions = discoverSessions(projectsDir, cwd)
    expect(sessions.length).toBe(2)
    const ids = sessions.map(s => s.id).sort()
    expect(ids).toEqual(["sess-123", "sess-456"])
  })

  test("returns empty array when project directory does not exist", () => {
    const sessions = discoverSessions(projectsDir, "/nonexistent/path")
    expect(sessions).toEqual([])
  })
})

describe("readSessionFromFile", () => {
  test("reads session info from JSONL file", () => {
    const info = readSessionFromFile(projectsDir, cwd, "sess-123")
    expect(info.id).toBe("sess-123")
    expect(info.title).toBe("Greeting Session")
    // directory comes from the fixture's first cwd field
    expect(info.directory).toBe("/home/user/project")
    expect(info.agent).toBe("claude-code")
    expect(info.time.created).toBeGreaterThan(0)
    expect(info.time.updated).toBeGreaterThan(0)
  })

  test("uses sessionID as title when no ai-title entry", () => {
    const info = readSessionFromFile(projectsDir, cwd, "sess-456")
    expect(info.title).toBe("sess-456")
  })

  test("throws on nonexistent session", () => {
    expect(() => readSessionFromFile(projectsDir, cwd, "nonexistent")).toThrow()
  })
})

describe("readMessagesFromFile", () => {
  test("returns messages excluding skip types", () => {
    const messages = readMessagesFromFile(projectsDir, cwd, "sess-123")
    expect(messages.length).toBe(4) // 5 entries minus 1 file-history-snapshot
    expect(messages[0].info.type).toBe("user")
    expect(messages[0].info.uuid).toBe("u1")
    expect(messages[1].info.type).toBe("assistant")
    expect(messages[2].info.type).toBe("ai-title")
    expect(messages[3].info.type).toBe("user")
  })

  test("parses content as array of parts", () => {
    const messages = readMessagesFromFile(projectsDir, cwd, "sess-123")
    // First message has string content -> converted to parts
    expect(Array.isArray(messages[0].parts)).toBe(true)
    expect(messages[0].parts[0].type).toBe("text")
    expect(messages[0].parts[0].text).toBe("Hello")

    // Fourth message has array content
    expect(messages[3].parts[0].type).toBe("text")
    expect(messages[3].parts[0].text).toBe("What is the weather?")
  })
})

describe("readRawContent", () => {
  test("returns raw file content", () => {
    const raw = readRawContent(projectsDir, cwd, "sess-123")
    expect(raw).toContain("Hello")
    expect(raw).toContain("Greeting Session")
    expect(raw).toContain("file-history-snapshot")
  })

  test("throws on nonexistent session", () => {
    expect(() => readRawContent(projectsDir, cwd, "nonexistent")).toThrow()
  })
})
