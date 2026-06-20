import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { getRepoKey } from "../cloud/config"

export interface WorktreeServiceConfig {
  port: number
  env?: string
}

export interface WorktreeConfig {
  services: Record<string, WorktreeServiceConfig>
}

export function getRegistryDir(repoKey: string): string {
  return path.join(os.homedir(), ".boons", "worktrees", repoKey)
}

export function loadWorktreeConfig(cwd?: string): WorktreeConfig | null {
  const configPath = path.join(os.homedir(), ".boons", "config.json")
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(fs.readFileSync(configPath, "utf-8"))
  } catch {
    raw = {}
  }

  const repoKey = getRepoKey(cwd)

  let services: Record<string, WorktreeServiceConfig> | undefined

  const topWorktree = (raw as any).worktree as { services?: Record<string, WorktreeServiceConfig> } | undefined
  if (topWorktree?.services) {
    services = { ...topWorktree.services }
  }

  if (repoKey) {
    const repos = (raw as any).repos as Record<string, { worktree?: { services?: Record<string, WorktreeServiceConfig> } }> | undefined
    const repoWorktree = repos?.[repoKey]?.worktree
    if (repoWorktree?.services) {
      services = { ...(services ?? {}), ...repoWorktree.services }
    }
  }

  if (!services || Object.keys(services).length === 0) return null

  return { services }
}
