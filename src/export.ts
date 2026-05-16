import * as path from "path"
import {
  getDefaultDBPath,
  readSessionFromDB,
  readMessagesFromDB,
  discoverSessions,
} from "./opencode"
import { getBranch, getAuthor } from "./git"

export interface ExportOptions {
  sessionID?: string
  dbPath?: string
}

export interface ExportResult {
  dir: string
  sessionID: string
  messageCount: number
}

export async function exportSession(opts: ExportOptions): Promise<ExportResult> {
  const cwd = process.cwd()
  const dbPath = opts.dbPath ?? getDefaultDBPath()
  const sessionID = opts.sessionID ?? resolveSessionID(dbPath, cwd)

  const [sessionInfo, messages, branch, author] = await Promise.all([
    readSessionFromDB(dbPath, sessionID),
    readMessagesFromDB(dbPath, sessionID),
    getBranch(cwd),
    getAuthor(cwd),
  ])

  const sessionDir = path.join(cwd, ".boons", branch, sessionID)

  await Bun.$`mkdir -p ${sessionDir}`

  const jsonl = messages.map((m) => JSON.stringify(m)).join("\n")
  await Bun.write(path.join(sessionDir, "raw.jsonl"), jsonl)

  const participants = new Set<string>()
  for (const m of messages) {
    const role = (m.info as Record<string, unknown>).role
    if (typeof role === "string") participants.add(role)
  }

  const info = {
    id: sessionID,
    name: sessionInfo.title,
    tool: "opencode",
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

function resolveSessionID(dbPath: string, cwd: string): string {
  const sessions = discoverSessions(dbPath, cwd)
  if (sessions.length === 0) {
    throw new Error(
      `No opencode sessions found for directory ${cwd}. ` +
        "Specify --session-id or open an opencode session in this project.",
    )
  }
  return sessions[0].id
}
