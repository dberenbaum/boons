import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import { getRepoKey } from "./cloud/config"
import { getWorktreeEnv } from "./worktree/registry"

export interface ScriptInfo {
  name: string
  description: string
  filePath: string
}

export interface RunResult {
  exitCode: number
  output: string
}

function boonsDataDir(baseDir?: string): string {
  return path.join(baseDir ?? os.homedir(), ".boons")
}

function projectDir(repoKey: string, baseDir?: string): string {
  return path.join(boonsDataDir(baseDir), "tasks", repoKey)
}

export function scriptsDirPath(repoKey: string, baseDir?: string): string {
  return path.join(projectDir(repoKey, baseDir), "scripts")
}

export function logFilePath(repoKey: string, name: string, baseDir?: string): string {
  return path.join(projectDir(repoKey, baseDir), ".logs", `${name}.log`)
}

export function logsDirPath(repoKey: string, baseDir?: string): string {
  return path.join(projectDir(repoKey, baseDir), ".logs")
}

export function envFilePath(repoKey: string, baseDir?: string): string {
  return path.join(projectDir(repoKey, baseDir), ".env")
}

function detectShebang(content: string): string | null {
  const firstLine = content.split("\n")[0]
  const m = firstLine?.match(/^#!\s*(\S+)(?:\s+(\S+))?/)
  if (!m) return null
  const interp = m[1] === "/usr/bin/env" || m[1] === "/bin/env" || m[1] === "env"
    ? m[2] || null
    : path.basename(m[1])
  return interp
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

export function createScript(
  repoKey: string,
  name: string,
  opts: {
    sourceFile?: string
    command?: string
    description?: string
    force?: boolean
    baseDir?: string
  },
): ScriptInfo {
  const cleanName = name.endsWith(".sh") ? name.slice(0, -3) : name
  if (!/^[a-zA-Z0-9_-]+$/.test(cleanName)) {
    throw new Error(`Invalid script name "${name}". Use alphanumeric characters, hyphens, and underscores.`)
  }
  const fileName = `${cleanName}.sh`

  let content: string
  let desc: string

  if (opts.sourceFile && opts.command) {
    throw new Error("Cannot use both --file and --command. Provide one or the other.")
  }

  if (opts.sourceFile) {
    content = fs.readFileSync(opts.sourceFile, "utf-8")
    const shebang = detectShebang(content)
    if (!shebang) {
      throw new Error("Script must have a shebang (e.g. #!/bin/bash)")
    }
    const parsedDesc = parseDescription(content)
    if (!parsedDesc) {
      throw new Error("Script must have a description comment (a # line after the shebang)")
    }
    desc = parsedDesc
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-"))
    const tmpFile = path.join(tmpDir, fileName)
    fs.writeFileSync(tmpFile, content)
    let valid = true
    let syntaxErr = ""
    if (shebang === "bash") {
      const r = Bun.spawnSync(["bash", "-n", tmpFile])
      valid = r.exitCode === 0
      syntaxErr = r.stderr.toString()
    } else if (shebang === "zsh") {
      const r = Bun.spawnSync(["zsh", "-n", tmpFile])
      valid = r.exitCode === 0
      syntaxErr = r.stderr.toString()
    }
    fs.rmSync(tmpDir, { recursive: true })
    if (!valid) {
      throw new Error(`Syntax validation failed:\n${syntaxErr}`)
    }
  } else if (opts.command) {
    desc = opts.description || `Run ${opts.command}`
    content = `#!/bin/bash\n# ${desc}\nset -euo pipefail\n\n${opts.command}\n`
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-"))
    const tmpFile = path.join(tmpDir, fileName)
    fs.writeFileSync(tmpFile, content)
    const r = Bun.spawnSync(["bash", "-n", tmpFile])
    if (r.exitCode !== 0) {
      fs.rmSync(tmpDir, { recursive: true })
      throw new Error(`Syntax validation failed:\n${r.stderr.toString()}`)
    }
    fs.rmSync(tmpDir, { recursive: true })
  } else {
    throw new Error("Provide either --file <path> or --command <string>")
  }

  const dir = scriptsDirPath(repoKey, opts.baseDir)
  const fp = path.join(dir, fileName)
  if (fs.existsSync(fp) && !opts.force) {
    throw new Error(`Script "${cleanName}" already exists. Use --force to overwrite.`)
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(fp, content)
  fs.chmodSync(fp, 0o755)

  return { name: cleanName, description: desc, filePath: fp }
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
  opts?: { verbose?: boolean; args?: string[]; baseDir?: string },
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

  let shell = "/bin/bash"
  try {
    const fileContent = fs.readFileSync(script.filePath, "utf-8")
    const interp = detectShebang(fileContent)
    if (interp === "zsh") shell = "/bin/zsh"
    else if (interp === "sh") shell = "/bin/sh"
    else if (interp === "bash") shell = "/bin/bash"
  } catch { /* use default /bin/bash */ }

  const worktreeVars = getWorktreeEnv(process.cwd())
  if (worktreeVars) {
    for (const [k, v] of Object.entries(worktreeVars)) {
      env[k] = v
    }
  }

  const result = Bun.spawnSync([shell, script.filePath, ...(opts?.args || [])], {
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
    fs.chmodSync(ep, 0o600)
  }
  const editor = process.env.EDITOR || process.env.VISUAL
  if (editor) {
    Bun.spawnSync([editor, ep], { stdio: ["inherit", "inherit", "inherit"] })
  } else {
    console.log(`Edit project env file:\n  ${ep}`)
  }
}

export function setEnvVar(repoKey: string, key: string, value: string, baseDir?: string): void {
  const ep = envFilePath(repoKey, baseDir)
  fs.mkdirSync(path.dirname(ep), { recursive: true })
  const existing = fs.existsSync(ep) ? fs.readFileSync(ep, "utf-8") : ""
  const lines = existing.split("\n")
  let found = false
  const updated = lines.map((line) => {
    const trimmed = line.trim()
    if (trimmed.startsWith("#") || !trimmed.includes("=")) return line
    const k = trimmed.split("=")[0].trim()
    if (k === key) {
      found = true
      return `${key}=${value}`
    }
    return line
  })
  if (!found) {
    updated.push(`${key}=${value}`)
  }
  const nl = updated.length > 0 ? "\n" : ""
  fs.writeFileSync(ep, updated.join("\n") + nl)
  fs.chmodSync(ep, 0o600)
}

export function getEnvVar(repoKey: string, key: string, baseDir?: string): string | null {
  const ep = envFilePath(repoKey, baseDir)
  if (!fs.existsSync(ep)) return null
  const content = fs.readFileSync(ep, "utf-8")
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const k = trimmed.split("=")[0].trim()
    if (k === key) return trimmed.slice(k.length + 1).trim()
  }
  return null
}

export function listEnvVars(repoKey: string, baseDir?: string): void {
  const ep = envFilePath(repoKey, baseDir)
  if (!fs.existsSync(ep)) {
    console.log("No environment variables set.")
    return
  }
  const content = fs.readFileSync(ep, "utf-8")
  let found = false
  for (const line of content.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.startsWith("#") || !trimmed.includes("=")) continue
    const k = trimmed.split("=")[0].trim()
    const v = trimmed.slice(k.length + 1).trim()
    console.log(`${k}=${v}`)
    found = true
  }
  if (!found) console.log("No environment variables set.")
}
