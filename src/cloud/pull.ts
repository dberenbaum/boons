import * as path from "path"
import { resolveConfig } from "./config"
import { createProvider } from "./factory"
import { getBranch } from "../git"

export interface PullOptions {
  sessionID?: string
  branch?: string
  directory?: string
}

export interface PullResult {
  pulled: number
  sessions: string[]
  branch: string
}

export async function pull(opts: PullOptions): Promise<PullResult> {
  const cwd = opts.directory ?? process.cwd()
  const resolved = resolveConfig(cwd)
  if (!resolved) throw new Error("No remote configured. Run `boons init --provider <name> --bucket <name>` or set up ~/.config/boons/config.json first.")
  const remote = resolved.remote

  const provider = createProvider(remote)
  const branch = opts.branch ?? getBranch(cwd)
  const remoteBase = remote.prefix
    ? path.posix.join(remote.prefix, branch)
    : branch

  let sessionIDs: string[]

  if (opts.sessionID) {
    sessionIDs = [opts.sessionID]
  } else {
    sessionIDs = await provider.listDirs(remoteBase)
    sessionIDs.sort()
  }

  if (sessionIDs.length === 0) {
    const detail = opts.sessionID
      ? `session ${opts.sessionID}`
      : "any sessions"
    throw new Error(`No remote sessions found for branch "${branch}" (${detail}).`)
  }

  for (const sessionID of sessionIDs) {
    const localDir = path.join(cwd, ".boons", branch, sessionID)
    const remoteDir = path.posix.join(remoteBase, sessionID)
    await provider.downloadDir(remoteDir, localDir)
  }

  return { pulled: sessionIDs.length, sessions: sessionIDs, branch }
}
