import * as path from "path"
import {
  getDefaultDBPath as getOpenCodeDBPath,
  readSessionFromDB,
  readMessagesFromDB,
  discoverSessions as discoverOpenCodeSessions,
} from "./opencode"
import {
  getDefaultProjectsDir,
  readSessionFromFile,
  readMessagesFromFile,
  readRawContent,
  discoverSessions as discoverClaudeSessions,
} from "./claude"
import { getBranch, getAuthor } from "./git"

const knownTools = ["opencode", "claude-code"] as const
export type Tool = (typeof knownTools)[number]

export function isKnownTool(s: string): s is Tool {
  return knownTools.includes(s as Tool)
}

export function validTools(): string[] {
  return [...knownTools]
}

export interface ExportOptions {
  tool: Tool
  sessionID?: string
  summary?: string
}

export interface ExportResult {
  dir: string
  sessionID: string
  messageCount: number
}

export async function exportSession(opts: ExportOptions): Promise<ExportResult> {
  const cwd = process.cwd()
  const sessionID = opts.sessionID ?? resolveSessionID(opts.tool, cwd)

  let sessionInfo: import("./opencode").SessionInfo
  let messages: import("./opencode").MessageEntry[]
  let branch: string
  let author: { name: string; email: string }

  if (opts.tool === "opencode") {
    const dbPath = getOpenCodeDBPath()
    ;[sessionInfo, messages, branch, author] = await Promise.all([
      readSessionFromDB(dbPath, sessionID),
      readMessagesFromDB(dbPath, sessionID),
      getBranch(cwd),
      getAuthor(cwd),
    ])
  } else {
    const projectsDir = getDefaultProjectsDir()
    ;[sessionInfo, messages, branch, author] = await Promise.all([
      readSessionFromFile(projectsDir, cwd, sessionID),
      readMessagesFromFile(projectsDir, cwd, sessionID),
      getBranch(cwd),
      getAuthor(cwd),
    ])
  }

  const sessionDir = path.join(cwd, ".boons", branch, sessionID)
  await Bun.$`mkdir -p ${sessionDir}`

  if (opts.tool === "claude-code") {
    const rawContent = readRawContent(getDefaultProjectsDir(), cwd, sessionID)
    await Bun.write(path.join(sessionDir, "raw.jsonl"), rawContent)
  } else {
    const jsonl = messages.map((m) => JSON.stringify(m)).join("\n")
    await Bun.write(path.join(sessionDir, "raw.jsonl"), jsonl)
  }

  if (opts.summary) {
    await Bun.write(path.join(sessionDir, "summary.md"), opts.summary + "\n")
  }

  const participants = new Set<string>()
  for (const m of messages) {
    const role = (m.info as Record<string, unknown>).role
    if (typeof role === "string") participants.add(role)
  }

  const info = {
    id: sessionID,
    name: sessionInfo.title,
    tool: opts.tool,
    author: author.name,
    email: author.email,
    branch,
    created: sessionInfo.time.created,
    updated: sessionInfo.time.updated,
    messageCount: messages.length,
    participants: [...participants],
  }
  await Bun.write(
    path.join(sessionDir, "info.json"),
    JSON.stringify(info, null, 2) + "\n",
  )

  return { dir: sessionDir, sessionID, messageCount: messages.length }
}

function resolveSessionID(tool: Tool, cwd: string): string {
  let sessions: import("./opencode").SessionInfo[]

  if (tool === "opencode") {
    sessions = discoverOpenCodeSessions(getOpenCodeDBPath(), cwd)
  } else {
    sessions = discoverClaudeSessions(getDefaultProjectsDir(), cwd)
  }

  if (sessions.length === 0) {
    throw new Error(
      `No ${tool} sessions found for directory ${cwd}. ` +
        "Specify --session-id or start a session in this project.",
    )
  }
  return sessions[0].id
}
