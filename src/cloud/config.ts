import * as path from "path"
import * as fs from "fs"

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

const CONFIG_FILE = "config.json"

export function configPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), ".boons", CONFIG_FILE)
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

export function writeConfig(config: Config, cwd?: string): void {
  const cp = configPath(cwd)
  const dir = path.dirname(cp)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(cp, JSON.stringify(config, null, 2) + "\n")
}
