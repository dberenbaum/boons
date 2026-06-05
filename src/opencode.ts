import { Database } from "bun:sqlite"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

export interface SessionInfo {
  id: string
  title: string
  slug: string
  directory: string
  agent: string
  model: string
  time: {
    created: number
    updated: number
  }
}

export interface MessageEntry {
  info: Record<string, unknown>
  parts: Record<string, unknown>[]
}

export function getDefaultDBPath(): string {
  if (process.env.BOONS_OPENCODE_DIR) return path.join(process.env.BOONS_OPENCODE_DIR, "opencode.db")
  const dataHome = process.env.XDG_DATA_HOME
    ?? path.join(os.homedir(), ".local/share")
  return path.join(dataHome, "opencode", "opencode.db")
}

export function readSessionFromDB(dbPath: string, sessionID: string): SessionInfo {
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db
      .query("SELECT * FROM session WHERE id = ?")
      .all(sessionID) as Record<string, unknown>[]

    if (rows.length === 0) {
      throw new Error(`Session not found: ${sessionID}`)
    }

    const r = rows[0]
    return {
      id: r.id as string,
      title: r.title as string,
      slug: r.slug as string,
      directory: r.directory as string,
      agent: (r.agent as string) ?? "",
      model: JSON.stringify(r.model) ?? "",
      time: {
        created: r.time_created as number,
        updated: r.time_updated as number,
      },
    }
  } finally {
    db.close()
  }
}

export function readMessagesFromDB(dbPath: string, sessionID: string): MessageEntry[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    const messages = db
      .query(
        "SELECT id, session_id, time_created, time_updated, data FROM message WHERE session_id = ? ORDER BY time_created",
      )
      .all(sessionID) as Record<string, unknown>[]

    const parts = db
      .query(
        "SELECT id, message_id, session_id, time_created, time_updated, data FROM part WHERE session_id = ? ORDER BY time_created",
      )
      .all(sessionID) as Record<string, unknown>[]

    const partsByMsg: Record<string, Record<string, unknown>[]> = {}
    for (const p of parts) {
      const mid = p.message_id as string
      if (!partsByMsg[mid]) partsByMsg[mid] = []
      const partData = JSON.parse(p.data as string)
      partsByMsg[mid].push({ id: p.id, ...partData })
    }

    return messages.map((m) => {
      const msgData = JSON.parse(m.data as string)
      const info = {
        id: m.id,
        sessionID: m.session_id,
        timeCreated: m.time_created,
        ...msgData,
      }
      return {
        info,
        parts: partsByMsg[m.id as string] ?? [],
      }
    })
  } finally {
    db.close()
  }
}

export function discoverSessions(dbPath: string, directory: string): SessionInfo[] {
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db
      .query(
        "SELECT * FROM session WHERE directory = ? ORDER BY time_updated DESC",
      )
      .all(directory) as Record<string, unknown>[]

    return rows.map((r) => ({
      id: r.id as string,
      title: r.title as string,
      slug: r.slug as string,
      directory: r.directory as string,
      agent: (r.agent as string) ?? "",
      model: JSON.stringify(r.model) ?? "",
      time: {
        created: r.time_created as number,
        updated: r.time_updated as number,
      },
    }))
  } finally {
    db.close()
  }
}

function getLogDir(): string | null {
  const dbPath = getDefaultDBPath()
  const dir = path.dirname(dbPath)
  const logDir = path.join(dir, "log")
  return fs.existsSync(logDir) ? logDir : null
}

function findProcessLogFile(pid: number): string | null {
  if (process.platform === "linux") {
    const fdDir = `/proc/${pid}/fd`
    try {
      for (const fd of fs.readdirSync(fdDir)) {
        const link = fs.readlinkSync(path.join(fdDir, fd))
        if (link.endsWith(".log") && fs.existsSync(link)) return link
      }
    } catch {}
    return null
  }

  if (process.platform === "darwin") {
    const result = Bun.spawnSync(["lsof", "-p", String(pid), "-Fn"])
    if (result.exitCode !== 0) return null
    for (const line of result.stdout.toString().split("\n")) {
      if (line.startsWith("n") && line.endsWith(".log")) {
        const filePath = line.slice(1)
        if (fs.existsSync(filePath)) return filePath
      }
    }
    return null
  }

  return null
}

function newestLogFile(logDir: string): string | null {
  try {
    const files = fs.readdirSync(logDir)
      .filter(f => f.endsWith(".log"))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
    return files.length > 0 ? path.join(logDir, files[0].name) : null
  } catch {
    return null
  }
}

function extractSessionID(filePath: string): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8")
    const matches = content.match(/session\.id=ses_\w+/g)
    if (!matches || matches.length === 0) return null
    return matches[matches.length - 1].split("=")[1]
  } catch {
    return null
  }
}

function validateSessionInDB(id: string, cwd: string, dbPath: string): boolean {
  const sessions = discoverSessions(dbPath, cwd)
  return sessions.some(s => s.id === id)
}

export function resolveActiveSessionID(cwd: string): string {
  const dbPath = getDefaultDBPath()
  const logDir = getLogDir()

  // Tier 1: Process fd tracing (Linux: /proc, macOS: lsof)
  const pid = process.env.OPENCODE_PID
  if (pid) {
    const logFile = findProcessLogFile(parseInt(pid, 10))
    if (logFile) {
      const id = extractSessionID(logFile)
      if (id) {
        if (validateSessionInDB(id, cwd, dbPath)) return id
        console.error(`Warning: session ${id} from process log not found for ${cwd}`)
      }
    }
  }

  // Tier 2: Log directory scan (all platforms)
  if (logDir) {
    const logFile = newestLogFile(logDir)
    if (logFile) {
      const id = extractSessionID(logFile)
      if (id) {
        if (validateSessionInDB(id, cwd, dbPath)) return id
        console.error(`Warning: session ${id} from log not found for ${cwd}`)
      }
    }
  }

  // Tier 3: SQLite query (most recently updated in this directory)
  const sessions = discoverSessions(dbPath, cwd)
  if (sessions.length > 0) return sessions[0].id

  // Tier 4: CLI fallback
  const result = Bun.spawnSync(["opencode", "session", "list", "--format", "json", "-n", "1"])
  if (result.exitCode === 0) {
    const list = JSON.parse(result.stdout.toString())
    if (list.length > 0) return list[0].id
  }

  throw new Error(
    `No opencode sessions found for directory ${cwd}. ` +
      "Specify --session-id or start an opencode session in this project.",
  )
}
