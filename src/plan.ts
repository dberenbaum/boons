import * as path from "path"
import * as fs from "fs"
import { getSessionsBranchDir } from "./cloud/config"

export type PlanKind = "plan" | "doc"

export interface PlanEntry {
  name: string
  source: string
  file: string
  savedAt: string
  kind: PlanKind
}

export interface PlanDoc extends PlanEntry {
  sessionID: string
  path: string
}

export const MANIFEST_FILE = "plans.json"

export function readManifest(sessionDir: string): PlanEntry[] {
  const mp = path.join(sessionDir, MANIFEST_FILE)
  try {
    return JSON.parse(fs.readFileSync(mp, "utf-8")) as PlanEntry[]
  } catch {
    return []
  }
}

export function writeManifest(sessionDir: string, entries: PlanEntry[]): void {
  fs.mkdirSync(sessionDir, { recursive: true })
  fs.writeFileSync(
    path.join(sessionDir, MANIFEST_FILE),
    JSON.stringify(entries, null, 2) + "\n",
  )
}

export function recordEntry(sessionDir: string, entry: PlanEntry): void {
  const entries = readManifest(sessionDir)
  const idx = entries.findIndex((e) => e.name === entry.name)
  if (idx >= 0) entries[idx] = entry
  else entries.push(entry)
  writeManifest(sessionDir, entries)
}

export function snapshotFiles(sessionDir: string, filePaths: string[], kind: PlanKind = "plan"): void {
  const savedAt = new Date().toISOString()
  for (const filePath of filePaths) {
    const name = path.basename(filePath)
    fs.mkdirSync(sessionDir, { recursive: true })
    fs.copyFileSync(filePath, path.join(sessionDir, name))
    recordEntry(sessionDir, { name, source: filePath, file: name, savedAt, kind })
  }
}

export function collectPlans(branch: string, cwd?: string): PlanDoc[] {
  const branchDir = getSessionsBranchDir(branch, cwd)
  const latest = new Map<string, PlanDoc>()
  for (const sessionID of listSessionDirs(branchDir)) {
    const sessionDir = path.join(branchDir, sessionID)
    for (const entry of readManifest(sessionDir)) {
      const doc: PlanDoc = {
        ...entry,
        sessionID,
        path: path.join(sessionDir, entry.file),
      }
      const existing = latest.get(entry.name)
      if (
        !existing ||
        entry.savedAt > existing.savedAt ||
        (entry.savedAt === existing.savedAt && sessionID > existing.sessionID)
      ) {
        latest.set(entry.name, doc)
      }
    }
  }
  return [...latest.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export function resolvePlan(branch: string, name: string, cwd?: string): PlanDoc | null {
  return collectPlans(branch, cwd).find((d) => d.name === name) ?? null
}

export interface WritePlanOptions {
  name: string
  content: string
  source?: string
  kind?: PlanKind
}

export function writePlan(
  branch: string,
  opts: WritePlanOptions,
  cwd?: string,
): { dir: string; entry: PlanEntry } {
  const branchDir = getSessionsBranchDir(branch, cwd)
  const target = latestSessionDir(branchDir) ?? createPlanOnlyDir(branchDir)
  fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, opts.name), opts.content)
  const entry: PlanEntry = {
    name: opts.name,
    source: opts.source ?? "",
    file: opts.name,
    savedAt: new Date().toISOString(),
    kind: opts.kind ?? "plan",
  }
  recordEntry(target, entry)
  return { dir: target, entry }
}

export function listSessionDirs(branchDir: string): string[] {
  try {
    return fs.readdirSync(branchDir).filter((n) => {
      try {
        return fs.statSync(path.join(branchDir, n)).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return []
  }
}

function latestSessionDir(branchDir: string): string | null {
  let best: string | null = null
  let bestUpdated = -1
  for (const name of listSessionDirs(branchDir)) {
    const dir = path.join(branchDir, name)
    let updated = -1
    try {
      const info = JSON.parse(
        fs.readFileSync(path.join(dir, "info.json"), "utf-8"),
      )
      updated = info.updated ? new Date(info.updated).getTime() : -1
    } catch {
      continue
    }
    if (updated >= bestUpdated) {
      bestUpdated = updated
      best = dir
    }
  }
  return best
}

function createPlanOnlyDir(branchDir: string): string {
  return path.join(branchDir, new Date().toISOString().replace(/[:.]/g, "-"))
}
