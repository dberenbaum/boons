import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { getRepoKey } from "./cloud/config"

export interface ScriptInfo {
  name: string
  description: string
  filePath: string
}

export interface RunResult {
  exitCode: number
  output: string
}

function projectDir(repoKey: string, baseDir?: string): string {
  return path.join(baseDir ?? os.homedir(), ".config", "boons", "projects", repoKey)
}

export function scriptsDirPath(repoKey: string, baseDir?: string): string {
  return path.join(projectDir(repoKey, baseDir), "scripts")
}

export function logFilePath(repoKey: string, name: string, baseDir?: string): string {
  return path.join(projectDir(repoKey, baseDir), ".logs", `${name}.log`)
}

export function envFilePath(repoKey: string, baseDir?: string): string {
  return path.join(projectDir(repoKey, baseDir), ".env")
}

function parseDescription(content: string): string {
  const lines = content.split("\n")
  const start = lines[0]?.startsWith("#!") ? 1 : 0
  for (let i = start; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith("#")) {
      return line.replace(/^#\s*/, "")
    }
    if (line.length > 0) break
  }
  return ""
}

export function listScripts(repoKey: string, baseDir?: string): ScriptInfo[] {
  const dir = scriptsDirPath(repoKey, baseDir)
  if (!fs.existsSync(dir)) return []

  const entries = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".sh"))
    .sort()

  const scripts: ScriptInfo[] = []
  for (const entry of entries) {
    const name = entry.slice(0, -3)
    const filePath = path.join(dir, entry)
    try {
      const content = fs.readFileSync(filePath, "utf-8")
      scripts.push({ name, description: parseDescription(content), filePath })
    } catch {
      scripts.push({ name, description: "", filePath })
    }
  }
  return scripts
}

export function getScript(repoKey: string, name: string, baseDir?: string): ScriptInfo | null {
  return listScripts(repoKey, baseDir).find((s) => s.name === name) ?? null
}

export function readLog(repoKey: string, name: string, baseDir?: string): string | null {
  const lp = logFilePath(repoKey, name, baseDir)
  if (!fs.existsSync(lp)) return null
  const content = fs.readFileSync(lp, "utf-8")
  const headerEnd = content.indexOf("\n")
  return headerEnd >= 0 ? content.slice(headerEnd + 1) : ""
}

export function readStatus(repoKey: string, name: string, baseDir?: string): number | null {
  const lp = logFilePath(repoKey, name, baseDir)
  if (!fs.existsSync(lp)) return null
  const content = fs.readFileSync(lp, "utf-8")
  const firstLine = content.split("\n")[0]
  const match = firstLine?.match(/^# exit: (\d+)/)
  return match ? parseInt(match[1], 10) : null
}

export function runScript(
  repoKey: string,
  name: string,
  opts?: { verbose?: boolean; baseDir?: string },
): RunResult {
  const script = getScript(repoKey, name, opts?.baseDir)
  if (!script) {
    return { exitCode: 1, output: `Task script "${name}" not found.` }
  }

  const ep = envFilePath(repoKey, opts?.baseDir)
  const env: Record<string, string> = {}

  for (const key of Object.keys(process.env)) {
    const val = process.env[key]
    if (val !== undefined) env[key] = val
  }

  if (fs.existsSync(ep)) {
    const envContent = fs.readFileSync(ep, "utf-8")
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const eqIdx = trimmed.indexOf("=")
      if (eqIdx < 0) continue
      const key = trimmed.slice(0, eqIdx).trim()
      const val = trimmed.slice(eqIdx + 1).trim()
      if (key) env[key] = val
    }
  }

  const result = Bun.spawnSync(["/bin/bash", script.filePath], {
    env,
    cwd: process.cwd(),
  })

  const output = result.stdout.toString() + result.stderr.toString()
  const exitCode = result.exitCode

  const lDir = path.dirname(logFilePath(repoKey, name, opts?.baseDir))
  fs.mkdirSync(lDir, { recursive: true })
  fs.writeFileSync(logFilePath(repoKey, name, opts?.baseDir), `# exit: ${exitCode}\n${output}`)

  return { exitCode, output: opts?.verbose ? output : "" }
}

export function printScripts(repoKey: string, baseDir?: string): void {
  const scripts = listScripts(repoKey, baseDir)
  if (scripts.length === 0) {
    console.log("No task scripts found.")
    return
  }
  const nameWidth = Math.max(...scripts.map((s) => s.name.length), 4)
  console.log("Task scripts:")
  for (const s of scripts) {
    const desc = s.description ? `  ${s.description}` : ""
    console.log(`  ${s.name.padEnd(nameWidth)}${desc}`)
  }
}

export function printCheck(repoKey: string, baseDir?: string): void {
  const scripts = listScripts(repoKey, baseDir)
  if (scripts.length === 0) {
    console.log("No task scripts found.")
    return
  }
  for (const s of scripts) {
    const content = fs.readFileSync(s.filePath, "utf-8")
    console.log(`# ${s.name}${s.description ? ` — ${s.description}` : ""}`)
    console.log(content.trim())
    console.log("")
  }
}

export function printPath(repoKey: string, baseDir?: string): void {
  console.log(scriptsDirPath(repoKey, baseDir))
}

export function handleEnv(repoKey: string, baseDir?: string): void {
  const ep = envFilePath(repoKey, baseDir)
  fs.mkdirSync(path.dirname(ep), { recursive: true })
  if (!fs.existsSync(ep)) {
    fs.writeFileSync(ep, `# Project environment variables\n# Sourced by boons task scripts\n`)
  }
  const editor = process.env.EDITOR || process.env.VISUAL
  if (editor) {
    Bun.spawnSync([editor, ep], { stdio: "inherit" })
  } else {
    console.log(`Edit project env file:\n  ${ep}`)
  }
}
