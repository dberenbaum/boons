import * as path from "path"
import * as fs from "fs"
import { resolveConfig, getRepoKey, getSessionsBranchDir } from "./config"
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
  if (!resolved) throw new Error("No remote configured. Run `boons remote --provider <name> --bucket <name>` or set up ~/.boons/config.json first.")
  const remote = resolved.remote

  const repoKey = getRepoKey(cwd)
  if (!repoKey) throw new Error("No git remote origin found. Set a remote to push sessions.")

  const provider = createProvider(remote)
  const branch = opts.branch ?? getBranch(cwd)
  const remoteBase = path.posix.join(...[remote.prefix, repoKey, branch].filter(Boolean))
  const sessionsDir = getSessionsBranchDir(branch, cwd)

  if (!fs.existsSync(sessionsDir)) {
    const detail = opts.sessionID
      ? `session ${opts.sessionID}`
      : "any sessions"
    throw new Error(`No saved sessions found for branch "${branch}" (${detail}). Save sessions first with \`boons session-save\`.`)
  }

  const entries = fs.readdirSync(sessionsDir)
  let sessionIDs = entries.filter((e) => {
    try { return fs.statSync(path.join(sessionsDir, e)).isDirectory() } catch { return false }
  })
  sessionIDs.sort()

  if (opts.sessionID) {
    sessionIDs = sessionIDs.filter((id) => id === opts.sessionID)
  }

  if (sessionIDs.length === 0) {
    const detail = opts.sessionID
      ? `session ${opts.sessionID}`
      : "any sessions"
    throw new Error(`No saved sessions found for branch "${branch}" (${detail}). Save sessions first with \`boons session-save\`.`)
  }

  for (const sessionID of sessionIDs) {
    const localDir = path.join(sessionsDir, sessionID)
    const remoteDir = path.posix.join(remoteBase, sessionID)
    await provider.uploadDir(localDir, remoteDir)
  }

  return { pushed: sessionIDs.length, sessions: sessionIDs, branch }
}
