import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { SessionInfo, MessageEntry } from "./opencode"

type JsonRecord = Record<string, unknown>

export function getDefaultCodexDir(): string {
  return process.env.BOONS_CODEX_DIR
    || process.env.CODEX_HOME
    || path.join(os.homedir(), ".codex")
}

function sessionsRoot(codexDir: string): string {
  return path.join(codexDir, "sessions")
}

function parseTimestamp(ts: unknown): number {
  if (typeof ts === "number") return ts
  if (typeof ts !== "string") return 0
  const ms = new Date(ts).getTime()
  return isNaN(ms) ? 0 : ms
}

function readAllLines(filePath: string): JsonRecord[] {
  const text = fs.readFileSync(filePath, "utf-8")
  const lines: JsonRecord[] = []
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

function listJsonlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []

  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...listJsonlFiles(entryPath))
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(entryPath)
    }
  }
  return out
}

function sessionMeta(entries: JsonRecord[]): JsonRecord | null {
  for (const entry of entries) {
    if (entry.type === "session_meta" && typeof entry.payload === "object" && entry.payload) {
      return entry.payload as JsonRecord
    }
  }
  return null
}

function firstUserText(entries: JsonRecord[]): string {
  for (const entry of entries) {
    const payload = entry.payload as JsonRecord | undefined
    if (entry.type !== "event_msg" || payload?.type !== "user_message") continue
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message.trim().split("\n")[0].slice(0, 80)
    }
  }

  for (const entry of entries) {
    const payload = entry.payload as JsonRecord | undefined
    if (entry.type !== "response_item" || payload?.type !== "message" || payload.role !== "user") {
      continue
    }
    const text = extractTextParts(payload.content).map(p => p.text).filter(Boolean).join("\n").trim()
    if (text) return text.split("\n")[0].slice(0, 80)
  }
  return ""
}

function buildSessionInfo(filePath: string, entries: JsonRecord[]): SessionInfo | null {
  const meta = sessionMeta(entries)
  if (!meta || typeof meta.id !== "string") return null

  const stat = fs.statSync(filePath)
  const created = parseTimestamp(meta.timestamp)
  const updated = entries.reduce((max, entry) => {
    const ts = parseTimestamp(entry.timestamp)
    return ts > max ? ts : max
  }, created || stat.mtimeMs)

  const title = firstUserText(entries) || meta.id
  const modelProvider = typeof meta.model_provider === "string" ? meta.model_provider : ""
  const originator = typeof meta.originator === "string" ? meta.originator : "codex"

  return {
    id: meta.id,
    title,
    slug: meta.id,
    directory: typeof meta.cwd === "string" ? meta.cwd : "",
    agent: originator,
    model: modelProvider,
    time: {
      created: created || stat.birthtimeMs,
      updated,
    },
  }
}

function findSessionFile(codexDir: string, sessionID: string): string {
  for (const filePath of listJsonlFiles(sessionsRoot(codexDir))) {
    const entries = readAllLines(filePath)
    const meta = sessionMeta(entries)
    if (meta?.id === sessionID) return filePath
  }
  throw new Error(`Codex session not found: ${sessionID}`)
}

function extractTextParts(content: unknown): { type: string; text: string }[] {
  if (typeof content === "string") return [{ type: "text", text: content }]
  if (!Array.isArray(content)) return []

  return content.flatMap((part) => {
    if (!part || typeof part !== "object") return []
    const p = part as JsonRecord
    const text = p.text ?? p.content
    if (typeof text !== "string" || text.length === 0) return []
    const type = typeof p.type === "string" ? p.type : "text"
    return [{ type, text }]
  })
}

export function discoverSessions(codexDir: string, cwd: string): SessionInfo[] {
  return listJsonlFiles(sessionsRoot(codexDir))
    .flatMap(filePath => {
      const entries = readAllLines(filePath)
      const info = buildSessionInfo(filePath, entries)
      if (!info || info.directory !== cwd) return []
      return [info]
    })
    .sort((a, b) => b.time.updated - a.time.updated)
}

export function readSessionFromFile(codexDir: string, sessionID: string): SessionInfo {
  const filePath = findSessionFile(codexDir, sessionID)
  const info = buildSessionInfo(filePath, readAllLines(filePath))
  if (!info) throw new Error(`Codex session metadata not found: ${sessionID}`)
  return info
}

export function readMessagesFromFile(codexDir: string, sessionID: string): MessageEntry[] {
  const filePath = findSessionFile(codexDir, sessionID)
  const entries = readAllLines(filePath)

  const eventMessages = entries.flatMap(entry => {
    const payload = entry.payload as JsonRecord | undefined
    if (entry.type !== "event_msg") return []

    const role = payload?.type === "user_message"
      ? "user"
      : payload?.type === "agent_message"
        ? "assistant"
        : null
    if (!role || typeof payload?.message !== "string" || payload.message.length === 0) return []

    return [{
      info: {
        type: entry.type,
        role,
        phase: payload.phase,
        timestamp: parseTimestamp(entry.timestamp),
      },
      parts: [{ type: "text", text: payload.message }],
    }]
  })

  if (eventMessages.length > 0) return eventMessages

  return entries.flatMap(entry => {
    const payload = entry.payload as JsonRecord | undefined
    if (entry.type !== "response_item" || payload?.type !== "message") return []

    const role = payload.role
    if (role !== "user" && role !== "assistant") return []

    const parts = extractTextParts(payload.content)
    if (parts.length === 0) return []

    return [{
      info: {
        type: entry.type,
        role,
        timestamp: parseTimestamp(entry.timestamp),
      },
      parts,
    }]
  })
}

export function readRawContent(codexDir: string, sessionID: string): string {
  return fs.readFileSync(findSessionFile(codexDir, sessionID), "utf-8")
}
