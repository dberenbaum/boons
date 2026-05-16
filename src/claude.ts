import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { SessionInfo, MessageEntry } from "./opencode"

export function getDefaultProjectsDir(): string {
  return process.env.BOONS_CLAUDE_DIR
    ?? path.join(os.homedir(), ".claude", "projects")
}

export function encodeProjectPath(cwd: string): string {
  return "-" + cwd.slice(1).replace(/\//g, "-")
}

export function discoverSessions(projectsDir: string, cwd: string): SessionInfo[] {
  const projectDir = path.join(projectsDir, encodeProjectPath(cwd))
  if (!fs.existsSync(projectDir)) return []

  const files = fs.readdirSync(projectDir)
    .filter(f => f.endsWith(".jsonl"))
    .map(f => ({
      name: f,
      mtime: fs.statSync(path.join(projectDir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime)

  return files.map(f => ({
    id: f.name.replace(".jsonl", ""),
    title: f.name,
    slug: f.name.replace(".jsonl", ""),
    directory: cwd,
    agent: "claude-code",
    model: "",
    time: { created: 0, updated: 0 },
  }))
}

function parseTimestamp(ts: string | undefined): number {
  if (!ts) return 0
  const ms = new Date(ts).getTime()
  return isNaN(ms) ? 0 : ms
}

function readAllLines(filePath: string): Record<string, unknown>[] {
  const text = fs.readFileSync(filePath, "utf-8")
  const lines: Record<string, unknown>[] = []
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      lines.push(JSON.parse(trimmed))
    } catch {
      // skip malformed lines
    }
  }
  return lines
}

function sessionFilePath(projectsDir: string, cwd: string, sessionID: string): string {
  const projectDir = path.join(projectsDir, encodeProjectPath(cwd))
  return path.join(projectDir, sessionID + ".jsonl")
}

export function readSessionFromFile(projectsDir: string, cwd: string, sessionID: string): SessionInfo {
  const filePath = sessionFilePath(projectsDir, cwd, sessionID)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Session file not found: ${filePath}`)
  }

  const lines = readAllLines(filePath)
  let title = sessionID
  let created = 0
  let updated = 0
  let gitBranch = ""
  let cwdFromFile = ""

  for (const entry of lines) {
    const ts = parseTimestamp(entry.timestamp as string | undefined)
    if (ts && (!created || ts < created)) created = ts
    if (ts && ts > updated) updated = ts

    if (!gitBranch && entry.gitBranch) gitBranch = entry.gitBranch as string
    if (!cwdFromFile && entry.cwd) cwdFromFile = entry.cwd as string

    if (entry.type === "ai-title" && entry.aiTitle) {
      title = entry.aiTitle as string
    }
  }

  return {
    id: sessionID,
    title,
    slug: sessionID,
    directory: cwdFromFile || cwd,
    agent: "claude-code",
    model: "",
    time: { created, updated },
  }
}

export function readMessagesFromFile(projectsDir: string, cwd: string, sessionID: string): MessageEntry[] {
  const filePath = sessionFilePath(projectsDir, cwd, sessionID)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Session file not found: ${filePath}`)
  }

  const entries = readAllLines(filePath)
  const skipTypes = new Set(["file-history-snapshot", "permission-mode", "last-prompt"])

  return entries
    .filter(entry => !skipTypes.has(entry.type as string))
    .map(entry => {
      const message = entry.message as Record<string, unknown> | undefined
      const role = message?.role as string | undefined
      const content = message?.content

      let parts: Record<string, unknown>[]
      if (Array.isArray(content)) {
        parts = content as Record<string, unknown>[]
      } else if (typeof content === "string") {
        parts = [{ type: "text", text: content }]
      } else {
        parts = []
      }

      const msgInfo: Record<string, unknown> = {
        type: entry.type,
        uuid: entry.uuid,
        parentUuid: entry.parentUuid,
        timestamp: entry.timestamp,
        sessionId: entry.sessionId,
        cwd: entry.cwd,
        gitBranch: entry.gitBranch,
        role: role ?? entry.type,
      }

      if (entry.type === "user" && entry.isMeta) {
        msgInfo.isMeta = true
      }

      return { info: msgInfo, parts }
    })
}

export function readRawContent(projectsDir: string, cwd: string, sessionID: string): string {
  const filePath = sessionFilePath(projectsDir, cwd, sessionID)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Session file not found: ${filePath}`)
  }
  return fs.readFileSync(filePath, "utf-8")
}
