import * as path from "path"
import * as fs from "fs"
import {
  resolveConfig,
  getRepoKey,
  getSessionsBranchDir,
  getSessionsBranchDirForKey,
  normalizeRepoKey,
} from "./config"
import { createProvider } from "./factory"
import { getBranch } from "../git"

export interface PullOptions {
  sessionID?: string
  branch?: string
  directory?: string
  repoKey?: string
}

export interface PullResult {
  pulled: number
  sessions: string[]
  branch: string
  repoKey: string
}

export async function pull(opts: PullOptions): Promise<PullResult> {
  const cwd = opts.directory ?? process.cwd()
  const resolved = resolveConfig(cwd)
  if (!resolved) throw new Error("No remote configured. Run `boons remote --provider <name> --bucket <name>` or set up ~/.boons/config.json first.")
  const remote = resolved.remote

  // An explicit --repo addresses any repo key without requiring it to be the
  // cwd's git remote (or a git repo at all).
  const repoKey = opts.repoKey
    ? normalizeRepoKey(opts.repoKey)
    : getRepoKey(cwd)
  if (!repoKey) throw new Error("No git remote origin found. Set a remote to pull sessions, or pass --repo <key>.")

  const provider = createProvider(remote)
  const branch = opts.branch ?? getBranch(cwd)
  const remoteBase = path.posix.join(...[remote.prefix, repoKey, branch].filter(Boolean))
  const sessionsBranchDir = opts.repoKey
    ? getSessionsBranchDirForKey(repoKey, branch)
    : getSessionsBranchDir(branch, cwd)

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
    throw new Error(`No remote sessions found for branch "${branch}" of "${repoKey}" (${detail}).`)
  }

  for (const sessionID of sessionIDs) {
    const localDir = path.join(sessionsBranchDir, sessionID)
    const remoteDir = path.posix.join(remoteBase, sessionID)
    fs.mkdirSync(localDir, { recursive: true })
    await provider.downloadDir(remoteDir, localDir)
  }

  return { pulled: sessionIDs.length, sessions: sessionIDs, branch, repoKey }
}
