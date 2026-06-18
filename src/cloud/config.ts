import * as path from "path"
import * as fs from "fs"
import * as os from "os"

export interface RemoteConfig {
  provider: "aws" | "gcp" | "azure"
  bucket?: string
  region?: string
  account?: string
  container?: string
  prefix?: string
}

export interface GlobalConfig {
  default?: RemoteConfig
  repos?: Record<string, RemoteConfig>
}

export interface ResolvedConfig {
  remote: RemoteConfig
  source: string
}

const CONFIG_FILE = "config.json"
const BOONS_DATA_DIR = ".boons"
const SESSIONS_DIR_NAME = "sessions"
const LOCAL_KEY_PREFIX = "_local"

export function globalConfigPath(): string {
  return path.join(os.homedir(), ".boons", CONFIG_FILE)
}

export function boonsDataDir(baseDir?: string): string {
  return path.join(baseDir ?? os.homedir(), BOONS_DATA_DIR)
}

export function readGlobalConfig(): GlobalConfig {
  const cp = globalConfigPath()
  try {
    const raw = fs.readFileSync(cp, "utf-8")
    return JSON.parse(raw) as GlobalConfig
  } catch {
    return {}
  }
}

export function writeGlobalConfig(config: GlobalConfig): void {
  const cp = globalConfigPath()
  const dir = path.dirname(cp)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(cp, JSON.stringify(config, null, 2) + "\n")
}

export function getRepoKey(cwd?: string): string | null {
  try {
    const result = Bun.spawnSync(
      ["git", "remote", "get-url", "origin"],
      { cwd: cwd ?? process.cwd() },
    )
    if (result.exitCode !== 0) return null
    let url = result.stdout.toString().trim()

    const protoIdx = url.indexOf("://")
    if (protoIdx >= 0) url = url.slice(protoIdx + 3)

    const atIdx = url.indexOf("@")
    if (atIdx >= 0) url = url.slice(atIdx + 1)

    const firstSlash = url.indexOf("/")
    const colonIdx = url.indexOf(":")
    if (colonIdx >= 0 && (firstSlash < 0 || colonIdx < firstSlash)) {
      url = url.slice(0, colonIdx) + "/" + url.slice(colonIdx + 1)
    }

    if (url.endsWith(".git")) url = url.slice(0, -4)
    if (url.endsWith("/")) url = url.slice(0, -1)

    return url
  } catch {
    return null
  }
}

function getLocalRepoKey(cwd?: string): string {
  const result = Bun.spawnSync(
    ["git", "rev-parse", "--show-toplevel"],
    { cwd: cwd ?? process.cwd() },
  )
  const toplevel = result.exitCode === 0
    ? result.stdout.toString().trim()
    : (cwd ?? process.cwd())
  return toplevel.replace(/\//g, "_").replace(/[^a-zA-Z0-9_\-.]/g, "-")
}

function maybeMigrateLocal(cwd: string | undefined, targetDir: string, baseDir?: string): void {
  const localKey = getLocalRepoKey(cwd)
  const localPath = path.join(boonsDataDir(baseDir), SESSIONS_DIR_NAME, LOCAL_KEY_PREFIX, localKey)
  if (!fs.existsSync(localPath)) return

  fs.mkdirSync(targetDir, { recursive: true })
  let migrated = 0
  for (const branch of fs.readdirSync(localPath)) {
    const srcBranch = path.join(localPath, branch)
    if (!fs.statSync(srcBranch).isDirectory()) continue
    const dstBranch = path.join(targetDir, branch)
    fs.mkdirSync(dstBranch, { recursive: true })
    for (const session of fs.readdirSync(srcBranch)) {
      try {
        fs.renameSync(path.join(srcBranch, session), path.join(dstBranch, session))
        migrated++
      } catch { /* skip individual failures */ }
    }
  }
  for (const branch of fs.readdirSync(localPath)) {
    try { fs.rmdirSync(path.join(localPath, branch)) } catch {}
  }
  try { fs.rmdirSync(localPath) } catch {}
  if (migrated > 0) {
    console.log(`Migrated ${migrated} session(s) to ${getRepoKey(cwd)}`)
  }
}

export function getRepoKeyOrLocal(cwd?: string): { key: string; isLocal: boolean } {
  const repoKey = getRepoKey(cwd)
  if (repoKey) return { key: repoKey, isLocal: false }
  return { key: LOCAL_KEY_PREFIX + "/" + getLocalRepoKey(cwd), isLocal: true }
}

export function getSessionsDir(cwd?: string, baseDir?: string): string {
  const repoKey = getRepoKey(cwd)
  if (repoKey) {
    const fullPath = path.join(boonsDataDir(baseDir), SESSIONS_DIR_NAME, repoKey)
    maybeMigrateLocal(cwd, fullPath, baseDir)
    return fullPath
  }
  const localKey = getLocalRepoKey(cwd)
  const fullPath = path.join(boonsDataDir(baseDir), SESSIONS_DIR_NAME, LOCAL_KEY_PREFIX, localKey)
  console.warn("No git remote origin found. Sessions keyed by project path.")
  return fullPath
}

export function getSessionsBranchDir(branch: string, cwd?: string, baseDir?: string): string {
  return path.join(getSessionsDir(cwd, baseDir), branch)
}

export function resolveConfig(cwd?: string): ResolvedConfig | null {
  const globalConfig = readGlobalConfig()
  const repoKey = getRepoKey(cwd)

  let merged: RemoteConfig | null = null
  let source = "none"

  if (globalConfig.default) {
    merged = { ...globalConfig.default }
    source = "~/.boons/config.json (default)"
  }

  if (repoKey && globalConfig.repos?.[repoKey]) {
    merged = { ...(merged ?? {}), ...globalConfig.repos[repoKey] }
    source = `~/.boons/config.json (repos.${repoKey})`
  }

  if (merged) return { remote: merged, source }
  return null
}
