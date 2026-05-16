import * as path from "path"
import * as os from "os"
import { resolveConfig } from "./config"
import { createProvider } from "./factory"
import { getBranch } from "../git"

export interface RemoteSession {
  sessionID: string
  name: string
  author: string
  created: string
  messageCount: number | null
}

export interface ListRemoteOptions {
  branch?: string
  directory?: string
}

export async function listRemote(opts: ListRemoteOptions): Promise<RemoteSession[]> {
  const cwd = opts.directory ?? process.cwd()
  const resolved = resolveConfig(cwd)
  if (!resolved) throw new Error("No remote configured. Run `boons init --provider <name> --bucket <name>` or set up ~/.config/boons/config.json first.")
  const remote = resolved.remote

  const provider = createProvider(remote)
  const branch = opts.branch ?? getBranch(cwd)
  const remoteBase = remote.prefix
    ? path.posix.join(remote.prefix, branch)
    : branch

  const sessionIDs = await provider.listDirs(remoteBase)
  sessionIDs.sort()

  const sessions: RemoteSession[] = []
  const tmpDir = fs_mkdtempSync(path.join(os.tmpdir(), "boons-remote-"))

  for (const sessionID of sessionIDs) {
    const infoPath = path.posix.join(remoteBase, sessionID, "info.json")
    const localTmp = path.join(tmpDir, `${sessionID}.json`)
    try {
      await provider.downloadFile(infoPath, localTmp)
      const raw = Bun.file(localTmp)
      const info = await raw.json()
      sessions.push({
        sessionID,
        name: info.name ?? "",
        author: info.author ?? "",
        created: info.created ? new Date(info.created).toISOString() : "",
        messageCount: info.messageCount ?? null,
      })
    } catch {
      sessions.push({
        sessionID,
        name: "",
        author: "",
        created: "",
        messageCount: null,
      })
    }
  }

  return sessions
}

function fs_mkdtempSync(prefix: string): string {
  const result = Bun.spawnSync(["mktemp", "-d", prefix + "XXXXXX"])
  return result.stdout.toString().trim()
}
