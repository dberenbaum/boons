import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  encodeProjectPath,
  discoverSessions,
  readSessionFromFile,
  readMessagesFromFile,
} from "../src/cursor"

let projectsDir: string
let cwd: string

beforeAll(() => {
  projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-cursor-projects-"))
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "boons-cursor-cwd-"))

  // Create agent-transcripts directory structure
  const transcriptDir = path.join(projectsDir, encodeProjectPath(cwd), "agent-transcripts")
  fs.mkdirSync(path.join(transcriptDir, "sess-abc"), { recursive: true })
  fs.mkdirSync(path.join(transcriptDir, "sess-def"), { recursive: true })

  // Copy sample fixture into both sessions
  const fixtureContent = fs.readFileSync(
    path.join(import.meta.dir, "fixtures", "sample-cursor.jsonl"),
    "utf-8",
  )
  fs.writeFileSync(path.join(transcriptDir, "sess-abc", "sess-abc.jsonl"), fixtureContent)
  fs.writeFileSync(path.join(transcriptDir, "sess-def", "sess-def.jsonl"), fixtureContent)
})

afterAll(() => {
  fs.rmSync(projectsDir, { recursive: true, force: true })
  fs.rmSync(cwd, { recursive: true, force: true })
})

describe("encodeProjectPath", () => {
  test("encodes simple path without leading dash", () => {
    expect(encodeProjectPath("/home/user/project")).toBe("home-user-project")
  })

  test("encodes path with numbers and dots", () => {
    expect(encodeProjectPath("/opt/my_app/v2.0")).toBe("opt-my_app-v2.0")
  })
})

describe("discoverSessions", () => {
  test("returns sessions sorted by mtime descending", () => {
    const sessions = discoverSessions(projectsDir, cwd)
    expect(sessions.length).toBe(2)
    expect(sessions.map(s => s.id).sort()).toEqual(["sess-abc", "sess-def"])
  })

  test("returns empty array when transcript directory does not exist", () => {
    const sessions = discoverSessions(projectsDir, "/nonexistent/path")
    expect(sessions).toEqual([])
  })
})

describe("readSessionFromFile", () => {
  test("reads session info from transcript file", () => {
    const info = readSessionFromFile(projectsDir, cwd, "sess-abc")
    expect(info.id).toBe("sess-abc")
    expect(info.title).toBe("sess-abc")
    expect(info.directory).toBe(cwd)
    expect(info.agent).toBe("cursor")
    expect(info.time.created).toBeGreaterThan(0)
  })

  test("throws on nonexistent session", () => {
    expect(() => readSessionFromFile(projectsDir, cwd, "nonexistent")).toThrow()
  })
})

describe("readMessagesFromFile", () => {
  test("returns all messages from transcript", () => {
    const messages = readMessagesFromFile(projectsDir, cwd, "sess-abc")
    expect(messages.length).toBe(3)
    expect(messages[0].info.role).toBe("user")
    expect(messages[1].info.role).toBe("assistant")
    expect(messages[2].info.role).toBe("user")
  })

  test("parses content as array of parts", () => {
    const messages = readMessagesFromFile(projectsDir, cwd, "sess-abc")
    expect(Array.isArray(messages[0].parts)).toBe(true)
    expect(messages[0].parts[0].text).toBe("Hello")

    expect(messages[2].parts[0].type).toBe("text")
    expect(messages[2].parts[0].text).toBe("What is the weather?")
  })
})
