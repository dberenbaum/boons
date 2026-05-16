import * as path from "path"
import { readConfig } from "./config"
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
  const config = readConfig(cwd)
  if (!config.remote) throw new Error("No remote configured. Run `boons init --provider <name> --bucket <name>` first.")

  const provider = createProvider(config.remote)
  const branch = opts.branch ?? getBranch(cwd)
  const remoteBase = config.remote.prefix
    ? path.posix.join(config.remote.prefix, branch)
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
