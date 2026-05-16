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

export interface Config {
  remote?: RemoteConfig
}

export interface GlobalConfig {
  default?: RemoteConfig
  repos?: Record<string, RemoteConfig>
}

const CONFIG_FILE = "config.json"

export function configPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), ".boons", CONFIG_FILE)
}

export function globalConfigPath(): string {
  return path.join(os.homedir(), ".config", "boons", CONFIG_FILE)
}

export function readConfig(cwd?: string): Config {
  const cp = configPath(cwd)
  try {
    const raw = fs.readFileSync(cp, "utf-8")
    return JSON.parse(raw) as Config
  } catch {
    return {}
  }
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

export interface ResolvedConfig {
  remote: RemoteConfig
  source: string
}

export function resolveConfig(cwd?: string): ResolvedConfig | null {
  const globalConfig = readGlobalConfig()
  const repoKey = getRepoKey(cwd)

  let merged: RemoteConfig | null = null
  let source = "none"

  if (globalConfig.default) {
    merged = { ...globalConfig.default }
    source = "~/.config/boons/config.json (default)"
  }

  if (repoKey && globalConfig.repos?.[repoKey]) {
    merged = { ...(merged ?? {}), ...globalConfig.repos[repoKey] }
    source = `~/.config/boons/config.json (repos.${repoKey})`
  }

  const perRepo = readConfig(cwd)
  if (perRepo.remote) {
    merged = { ...(merged ?? {}), ...perRepo.remote }
    source = "per-repo .boons/config.json"
  }

  if (merged) return { remote: merged, source }
  return null
}

export function writeConfig(config: Config, cwd?: string): void {
  const cp = configPath(cwd)
  const dir = path.dirname(cp)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(cp, JSON.stringify(config, null, 2) + "\n")
}

export function writeGlobalConfig(config: GlobalConfig): void {
  const cp = globalConfigPath()
  const dir = path.dirname(cp)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(cp, JSON.stringify(config, null, 2) + "\n")
}
