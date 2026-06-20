import * as path from "path"
import * as fs from "fs"
import { getRepoKey } from "../cloud/config"
import { getRegistryDir, loadWorktreeConfig } from "./config"

interface RegistryEntry {
  branch: string
  created: string
}

interface ServiceAllocation {
  port: number
  base: number
}

interface PortReservation {
  worktree: string
  service: string
}

interface Registry {
  version: number
  worktrees: Record<string, RegistryEntry>
  allocations: Record<string, Record<string, ServiceAllocation>>
  port_reservations: Record<string, PortReservation>
}

function registryFilePath(repoKey: string): string {
  return path.join(getRegistryDir(repoKey), "registry.json")
}

function loadRegistry(repoKey: string): Registry {
  const fp = registryFilePath(repoKey)
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8"))
  } catch {
    return { version: 1, worktrees: {}, allocations: {}, port_reservations: {} }
  }
}

function saveRegistry(repoKey: string, registry: Registry): void {
  const fp = registryFilePath(repoKey)
  fs.mkdirSync(path.dirname(fp), { recursive: true })
  fs.writeFileSync(fp, JSON.stringify(registry, null, 2) + "\n")
}

function getWorktreePath(cwd?: string): string | null {
  try {
    const result = Bun.spawnSync(
      ["git", "rev-parse", "--show-toplevel"],
      { cwd: cwd ?? process.cwd() },
    )
    if (result.exitCode !== 0) return null
    return result.stdout.toString().trim()
  } catch {
    return null
  }
}

function getBranch(cwd?: string): string | null {
  try {
    const result = Bun.spawnSync(
      ["git", "rev-parse", "--abbrev-ref", "HEAD"],
      { cwd: cwd ?? process.cwd() },
    )
    if (result.exitCode !== 0) return null
    return result.stdout.toString().trim()
  } catch {
    return null
  }
}

function pruneStale(repoKey: string, registry: Registry): void {
  const worktreePaths = Object.keys(registry.worktrees)
  if (worktreePaths.length === 0) return

  const firstPath = worktreePaths[0]
  const result = Bun.spawnSync(
    ["git", "worktree", "list"],
    { cwd: firstPath },
  )
  if (result.exitCode !== 0) return

  const activePaths = new Set<string>()
  for (const line of result.stdout.toString().trim().split("\n")) {
    const parts = line.trim().split(/\s+/)
    if (parts[0]) activePaths.add(parts[0])
  }

  for (const wp of worktreePaths) {
    if (!activePaths.has(wp)) {
      const allocations = registry.allocations[wp] ?? {}
      for (const alloc of Object.values(allocations)) {
        delete registry.port_reservations[String(alloc.port)]
      }
      delete registry.allocations[wp]
      delete registry.worktrees[wp]
    }
  }
}

export function register(cwd?: string): { success: boolean; error?: string } {
  const worktreePath = getWorktreePath(cwd)
  if (!worktreePath) return { success: false, error: "Not in a git repository" }

  const repoKey = getRepoKey(cwd)
  if (!repoKey) return { success: false, error: "No git remote origin found" }

  const config = loadWorktreeConfig(cwd)
  if (!config) return { success: false, error: "No worktree services configured. Add a `worktree.services` block to ~/.boons/config.json" }

  const registry = loadRegistry(repoKey)

  if (registry.allocations[worktreePath]) return { success: true }

  pruneStale(repoKey, registry)

  const branch = getBranch(cwd)
  if (!branch) return { success: false, error: "Could not determine branch" }

  const allocations: Record<string, ServiceAllocation> = {}

  for (const [name, svc] of Object.entries(config.services)) {
    let port = svc.port
    while (registry.port_reservations[String(port)]) {
      port++
      if (port > 65535) {
        return { success: false, error: `No available port for "${name}" (exhausted from ${svc.port})` }
      }
    }
    allocations[name] = { port, base: svc.port }
    registry.port_reservations[String(port)] = { worktree: worktreePath, service: name }
  }

  registry.worktrees[worktreePath] = {
    branch,
    created: new Date().toISOString(),
  }
  registry.allocations[worktreePath] = allocations

  saveRegistry(repoKey, registry)

  return { success: true }
}

export function unregister(cwd?: string): { success: boolean; error?: string } {
  const worktreePath = getWorktreePath(cwd)
  if (!worktreePath) return { success: false, error: "Not in a git repository" }

  const repoKey = getRepoKey(cwd)
  if (!repoKey) return { success: false, error: "No git remote origin found" }

  const registry = loadRegistry(repoKey)

  const allocations = registry.allocations[worktreePath]
  if (!allocations) return { success: true }

  for (const alloc of Object.values(allocations)) {
    delete registry.port_reservations[String(alloc.port)]
  }

  delete registry.allocations[worktreePath]
  delete registry.worktrees[worktreePath]

  saveRegistry(repoKey, registry)

  return { success: true }
}

export interface WorktreeInfo {
  worktreePath: string
  branch: string
  created: string
  ports: Record<string, number>
}

export function listWorktrees(cwd?: string): WorktreeInfo[] {
  const repoKey = getRepoKey(cwd)
  if (!repoKey) return []

  const registry = loadRegistry(repoKey)

  pruneStale(repoKey, registry)
  saveRegistry(repoKey, registry)

  const entries: WorktreeInfo[] = []

  for (const [wp, entry] of Object.entries(registry.worktrees)) {
    const allocs = registry.allocations[wp] ?? {}
    const ports: Record<string, number> = {}
    for (const [name, alloc] of Object.entries(allocs)) {
      ports[name] = alloc.port
    }
    entries.push({
      worktreePath: wp,
      branch: entry.branch,
      created: entry.created,
      ports,
    })
  }

  return entries.sort((a, b) => a.branch.localeCompare(b.branch))
}

export function getServicePort(service: string, cwd?: string): number | null {
  const worktreePath = getWorktreePath(cwd)
  if (!worktreePath) return null

  const repoKey = getRepoKey(cwd)
  if (!repoKey) return null

  const registry = loadRegistry(repoKey)
  const alloc = registry.allocations[worktreePath]?.[service]
  return alloc?.port ?? null
}

export function getWorktreeEnv(cwd?: string): Record<string, string> | null {
  const worktreePath = getWorktreePath(cwd)
  if (!worktreePath) return null

  const repoKey = getRepoKey(cwd)
  if (!repoKey) return null

  const registry = loadRegistry(repoKey)
  const allocations = registry.allocations[worktreePath]
  const worktree = registry.worktrees[worktreePath]
  if (!allocations) return null

  const env: Record<string, string> = {}

  if (worktree?.branch) {
    env["COMPOSE_PROJECT_NAME"] = worktree.branch
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
  }

  const config = loadWorktreeConfig(cwd)

  for (const [name, alloc] of Object.entries(allocations)) {
    const portStr = String(alloc.port)
    const namespacedKey = `BOONS_WORKTREE_PORT_${name.toUpperCase().replace(/[^a-zA-Z0-9_]/g, "_")}`
    env[namespacedKey] = portStr

    if (config?.services[name]?.env) {
      env[config.services[name].env!] = portStr
    }
  }

  return env
}

export function hasAllocations(cwd?: string): boolean {
  const worktreePath = getWorktreePath(cwd)
  if (!worktreePath) return false

  const repoKey = getRepoKey(cwd)
  if (!repoKey) return false

  const registry = loadRegistry(repoKey)
  return !!registry.allocations[worktreePath]
}
