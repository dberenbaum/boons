import { Database } from "bun:sqlite"
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
