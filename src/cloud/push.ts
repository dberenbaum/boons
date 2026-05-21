import * as path from "path"
import { Glob } from "bun"
import { resolveConfig, getRepoKey } from "./config"
import { createProvider } from "./factory"
import { getBranch } from "../git"

export interface PushOptions {
  sessionID?: string
  branch?: string
  directory?: string
}

export interface PushResult {
  pushed: number
  sessions: string[]
  branch: string
}

export async function push(opts: PushOptions): Promise<PushResult> {
  const cwd = opts.directory ?? process.cwd()
  const resolved = resolveConfig(cwd)
  if (!resolved) throw new Error("No remote configured. Run `boons init --provider <name> --bucket <name>` or set up ~/.config/boons/config.json first.")
  const remote = resolved.remote

  const provider = createProvider(remote)
  const branch = opts.branch ?? getBranch(cwd)
  const repoKey = getRepoKey(cwd) ?? ""
  const remoteBase = path.posix.join(...[remote.prefix, repoKey, branch].filter(Boolean))

  const boonsDir = path.join(cwd, ".boons", branch)
  const pattern = opts.sessionID
    ? `${branch}/${opts.sessionID}/info.json`
    : `${branch}/*/info.json`

  const glob = new Glob(pattern)
  const sessions: string[] = []

  for await (const match of glob.scan(path.join(cwd, ".boons"))) {
    const parts = match.split("/")
    const sessionID = parts[parts.length - 2]
    sessions.push(sessionID)
  }

  if (sessions.length === 0) {
    const detail = opts.sessionID
      ? `session ${opts.sessionID}`
      : "any sessions"
    throw new Error(`No saved sessions found for branch "${branch}" (${detail}). Save sessions first with \`boons session-save\`.`)
  }

  for (const sessionID of sessions) {
    const localDir = path.join(boonsDir, sessionID)
    const remoteDir = path.posix.join(remoteBase, sessionID)
    await provider.uploadDir(localDir, remoteDir)
  }

  return { pushed: sessions.length, sessions, branch }
}
