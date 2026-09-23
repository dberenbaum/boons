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

/**
 * Normalize a git remote URL to a `host/org/repo` key.
 * Accepts HTTPS, SSH (`git@host:org/repo.git`), and already-normalized keys.
 */
export function normalizeRepoKey(input: string): string {
  let url = input.trim()

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
}

export function getRepoKey(cwd?: string): string | null {
  try {
    const result = Bun.spawnSync(
      ["git", "remote", "get-url", "origin"],
      { cwd: cwd ?? process.cwd() },
    )
    if (result.exitCode !== 0) return null
    return normalizeRepoKey(result.stdout.toString())
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

/** Sessions dir for an explicit repo key — no git or cwd required. */
export function getSessionsDirForKey(repoKey: string, baseDir?: string): string {
  return path.join(boonsDataDir(baseDir), SESSIONS_DIR_NAME, repoKey)
}

/** Branch-scoped sessions dir for an explicit repo key. */
export function getSessionsBranchDirForKey(
  repoKey: string,
  branch: string,
  baseDir?: string,
): string {
  return path.join(getSessionsDirForKey(repoKey, baseDir), branch)
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * The layout `sessions/<repoKey>/<branch>/<session-id>/` is ambiguous because
 * repo keys and branch names can both contain slashes. Two signals resolve it:
 * sessions are the only level that contains files, and every exported session
 * records its full branch name in `info.json` — so a branch like `feat/auth`
 * can be recognized from its first path segment.
 */
function isSessionDir(dir: string): boolean {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return false
  }
  return entries.some((e) => !isDirectory(path.join(dir, e)))
}

function childDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir).filter((e) => isDirectory(path.join(dir, e)))
  } catch {
    return []
  }
}

/** A branch dir directly contains at least one session dir. */
function isBranchDir(dir: string): boolean {
  return childDirs(dir).some((c) => isSessionDir(path.join(dir, c)))
}

/** Branch name recorded by a session anywhere under `dir`, if any. */
function descendantSessionBranch(dir: string): string | null {
  for (const child of childDirs(dir)) {
    const childPath = path.join(dir, child)
    if (isSessionDir(childPath)) {
      try {
        const info = JSON.parse(
          fs.readFileSync(path.join(childPath, "info.json"), "utf-8"),
        ) as { branch?: string }
        if (info.branch) return info.branch
      } catch {
        // plan-only or unreadable session — fall through to heuristics
      }
      continue
    }
    const found = descendantSessionBranch(childPath)
    if (found) return found
  }
  return null
}

/** Does `name` name the first segment of a branch inside `dir`? */
function isBranchRoot(dir: string, name: string): boolean {
  if (isBranchDir(dir)) return true
  const branch = descendantSessionBranch(dir)
  return branch ? branch.startsWith(`${name}/`) : false
}

/**
 * Find repo roots: a directory is a repo root as soon as one of its children
 * starts a branch. Repo keys and branch names are both slash-separated, so
 * without that marker the walk would descend into the branch.
 */
function findRepoRoots(dir: string, prefix: string, out: string[]): void {
  const children = childDirs(dir)
  if (children.length === 0) return
  if (children.some((c) => isBranchRoot(path.join(dir, c), c))) {
    out.push(prefix)
    return
  }
  for (const child of children) {
    findRepoRoots(path.join(dir, child), prefix ? `${prefix}/${child}` : child, out)
  }
}

/**
 * Every repo key that has locally stored sessions. Machine-local repos live
 * under `_local/` and are returned as `_local/<path-key>`.
 */
export function listRepoKeys(baseDir?: string): string[] {
  const sessionsRoot = path.join(boonsDataDir(baseDir), SESSIONS_DIR_NAME)
  const keys: string[] = []
  findRepoRoots(sessionsRoot, "", keys)
  return keys.sort()
}

/** Branch names (which may themselves contain slashes) for a repo key. */
export function listBranches(repoKey: string, baseDir?: string): string[] {
  const repoDir = getSessionsDirForKey(repoKey, baseDir)
  const branches: string[] = []

  const walk = (dir: string, prefix: string) => {
    for (const child of childDirs(dir)) {
      const childPath = path.join(dir, child)
      const segment = prefix ? `${prefix}/${child}` : child
      if (isBranchDir(childPath)) {
        branches.push(segment)
        continue
      }
      // Slash-containing branch: the session records the full name.
      const recorded = descendantSessionBranch(childPath)
      if (recorded && recorded.startsWith(`${segment}/`)) {
        branches.push(recorded)
        continue
      }
      walk(childPath, segment)
    }
  }
  walk(repoDir, "")

  return [...new Set(branches)].sort()
}

/**
 * Resolve a `--repo` value (normalized key or raw remote URL) to the key that
 * addresses stored sessions. `known` is false when no sessions have ever been
 * saved for that key — the caller turns that into a "pull it first" hint.
 */
export function resolveRepoKey(
  input: string,
  baseDir?: string,
): { key: string; known: boolean } {
  const key = normalizeRepoKey(input)
  return { key, known: isDirectory(getSessionsDirForKey(key, baseDir)) }
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
