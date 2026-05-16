import { Database } from "bun:sqlite"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { SessionInfo, MessageEntry } from "./opencode"

export function getDefaultProjectsDir(): string {
  return process.env.BOONS_CURSOR_DIR
    ?? path.join(os.homedir(), ".cursor", "projects")
}

export function getDefaultGlobalDbPath(): string {
  return path.join(os.homedir(), ".config", "Cursor", "User", "globalStorage", "state.vscdb")
}

export function encodeProjectPath(cwd: string): string {
  return cwd.slice(1).replace(/\//g, "-")
}

function transcriptFilePath(projectsDir: string, cwd: string, sessionID: string): string {
  return path.join(projectsDir, encodeProjectPath(cwd), "agent-transcripts", sessionID, sessionID + ".jsonl")
}

export function discoverSessions(projectsDir: string, cwd: string): SessionInfo[] {
  const transcriptsDir = path.join(projectsDir, encodeProjectPath(cwd), "agent-transcripts")
  if (!fs.existsSync(transcriptsDir)) return []

  return fs.readdirSync(transcriptsDir)
    .filter(d => fs.statSync(path.join(transcriptsDir, d)).isDirectory())
    .map(d => ({ id: d, mtime: fs.statSync(path.join(transcriptsDir, d)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .map(d => ({
      id: d.id,
      title: d.id,
      slug: d.id,
      directory: cwd,
      agent: "cursor",
      model: "",
      time: { created: 0, updated: 0 },
    }))
}

function lookupComposerMeta(
  globalDbPath: string,
  sessionID: string,
): { name: string; created: number; updated: number } | null {
  if (!fs.existsSync(globalDbPath)) return null
  try {
    const db = new Database(globalDbPath, { readonly: true })
    try {
      const row = db
        .query("SELECT value FROM ItemTable WHERE key = 'composer.composerHeaders'")
        .get() as { value: string } | null
      if (!row) return null
      const parsed = JSON.parse(row.value) as {
        allComposers?: Array<{
          composerId: string
          name?: string
          createdAt?: number
          lastUpdatedAt?: number
        }>
      }
      const entry = parsed.allComposers?.find(c => c.composerId === sessionID)
      if (!entry) return null
      return {
        name: entry.name ?? sessionID,
        created: entry.createdAt ?? 0,
        updated: entry.lastUpdatedAt ?? 0,
      }
    } finally {
      db.close()
    }
  } catch {
    return null
  }
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

export function readSessionFromFile(projectsDir: string, cwd: string, sessionID: string): SessionInfo {
  const filePath = transcriptFilePath(projectsDir, cwd, sessionID)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cursor session transcript not found: ${filePath}`)
  }

  const meta = lookupComposerMeta(getDefaultGlobalDbPath(), sessionID)
  const mtime = fs.statSync(filePath).mtimeMs

  return {
    id: sessionID,
    title: meta?.name ?? sessionID,
    slug: sessionID,
    directory: cwd,
    agent: "cursor",
    model: "",
    time: {
      created: meta?.created ?? mtime,
      updated: meta?.updated ?? mtime,
    },
  }
}

export function readMessagesFromFile(projectsDir: string, cwd: string, sessionID: string): MessageEntry[] {
  const filePath = transcriptFilePath(projectsDir, cwd, sessionID)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cursor session transcript not found: ${filePath}`)
  }

  return readAllLines(filePath).map(entry => {
    const role = entry.role as string | undefined
    const content = (entry.message as Record<string, unknown> | undefined)?.content

    let parts: Record<string, unknown>[]
    if (Array.isArray(content)) {
      parts = content as Record<string, unknown>[]
    } else if (typeof content === "string") {
      parts = [{ type: "text", text: content }]
    } else {
      parts = []
    }

    return { info: { role: role ?? "unknown" }, parts }
  })
}

export function readRawContent(projectsDir: string, cwd: string, sessionID: string): string {
  const filePath = transcriptFilePath(projectsDir, cwd, sessionID)
  if (!fs.existsSync(filePath)) {
    throw new Error(`Cursor session transcript not found: ${filePath}`)
  }
  return fs.readFileSync(filePath, "utf-8")
}
