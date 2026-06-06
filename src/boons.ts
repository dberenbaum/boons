import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import * as readline from "node:readline"
import { Glob } from "bun"
import { exportSession, isKnownTool, validTools } from "./export"
import {
  getDefaultDBPath,
  readSessionFromDB,
  readMessagesFromDB,
} from "./opencode"
import {
  getDefaultProjectsDir as getClaudeProjectsDir,
  readSessionFromFile as readClaudeSessionFromFile,
  readMessagesFromFile as readClaudeMessagesFromFile,
} from "./claude"
import {
  getDefaultProjectsDir as getCursorProjectsDir,
  readSessionFromFile as readCursorSessionFromFile,
  readMessagesFromFile as readCursorMessagesFromFile,
} from "./cursor"
import {
  getDefaultCodexDir,
  readSessionFromFile as readCodexSessionFromFile,
  readMessagesFromFile as readCodexMessagesFromFile,
} from "./codex"
import {
  readConfig,
  writeConfig,
  writeGlobalConfig,
  readGlobalConfig,
  getRepoKey,
  resolveConfig,
  push,
  pull,
  listRemote,
} from "./cloud"
import {
  runScript,
  readLog,
  readStatus,
  listScripts,
  getScript,
  printScripts,
  printCheck,
  printPath,
  handleEnv,
  scriptsDirPath,
  logFilePath,
} from "./task"

let pipedAnswers: string[] | null | undefined
let pipedAnswersLoaded = false

async function loadPipedAnswersIfNeeded(): Promise<void> {
  if (pipedAnswersLoaded) return
  pipedAnswersLoaded = true

  if (process.stdin.isTTY) {
    pipedAnswers = null
    return
  }

  let st: fs.Stats
  try {
    st = fs.fstatSync(0)
  } catch {
    pipedAnswers = null
    return
  }

  if (st.isFile()) {
    pipedAnswers = fs.readFileSync(0, "utf-8").split("\n").map((l) => l.trim())
    return
  }

  if (st.isFIFO() || st.isSocket()) {
    const readable = process.stdin as NodeJS.ReadableStream & { readableLength?: number }
    if ((readable.readableLength ?? 0) === 0) {
      pipedAnswers = null
      return
    }
    const rl = readline.createInterface({ input: process.stdin, terminal: false })
    const lines: string[] = []
    for await (const line of rl) {
      lines.push(line.trim())
    }
    rl.close()
    pipedAnswers = lines
    return
  }

  pipedAnswers = null
}

async function ask(query: string): Promise<string> {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    return new Promise((resolve) => {
      rl.question(query + " ", (answer) => {
        rl.close()
        resolve(answer.trim())
      })
    })
  }

  await loadPipedAnswersIfNeeded()

  if (pipedAnswers !== null && pipedAnswers !== undefined) {
    const answer = pipedAnswers.shift() ?? ""
    console.log(`${query} ${answer}`)
    return answer
  }

  console.error("Interactive input required but stdin is not a terminal.")
  console.error(
     "Use provider flags (e.g. boons remote --provider gcp --bucket NAME) or run from a terminal.",
  )
  process.exit(1)
}

async function askRequired(query: string, label: string): Promise<string> {
  while (true) {
    const answer = await ask(query)
    if (answer) return answer
    console.log(`${label} required.`)
  }
}

const HELP = `boons — collaborative session artifact tool

Usage:
  boons session-read --tool <name> --session-id <id>   Read session messages as text
  boons session-save --tool <name> --session-id <id> --summary <text> [--file <path>...] [--json]
                                                        Save session + authored files
  boons ls [--branch <name>] [--json]                   List saved sessions
  boons ls --remote [--branch <name>] [--json]          List remote sessions
  boons install <tool>                                Install skills for a tool (+ global .gitignore + global rules)
  boons install <tool> --project                      Install skills scoped to the project (+ project .gitignore + project rules)
  boons remote                                          Show remote config, or prompt if none
  boons remote --provider aws|gcp|azure ...             Configure cloud remote
  boons remote --project --provider aws|gcp|azure ...   Configure cloud remote per-project
  boons push [--session-id <id>] [--branch <b>]         Push sessions to cloud
   boons pull [--session-id <id>] [--branch <b>]         Pull sessions from cloud
   boons task [<name>] [--verbose]                        Run a task script (default: setup.sh)
   boons task --list                                      List available task scripts
   boons task --check                                     Print task scripts without running
   boons task --path                                      Print task scripts directory
   boons task --env                                       Open project .env file
   boons task read <name> [--status]                      Read task output or exit status
   boons --help                                          Show this message

Remote flags:
  --provider aws|gcp|azure  Cloud provider
  --bucket <name>           Bucket name (aws/gcp)
  --region <name>           AWS region
  --account <name>          Azure storage account
  --container <name>        Azure container
  --prefix <path>           Optional key prefix in bucket

Options:
  --tool <name>       Tool to read from (opencode | claude-code | cursor | codex)
  --summary <text>    Session summary (required for session-save)
  --session-id <id>   Session to read/save/push/pull (required for session-read, auto-detect for others)
  --file <path>       File to include in session directory (repeatable, for session-save)
  --branch <name>     Filter by branch (default: current branch)
  --global            Install globally (default; use --project for project-scoped)
  --json              Output as JSON (for tool integration)

Tools:
  opencode       OpenCode skills
  claude-code    Anthropic Claude Code skills
  cursor         Cursor MDC rules
  codex          OpenAI Codex skills

Environment:
  BOONS_OPENCODE_DIR  OpenCode data directory (default: $XDG_DATA_HOME/opencode or ~/.local/share/opencode)
  BOONS_CLAUDE_DIR    Claude Code projects directory (default: ~/.claude/projects)
  BOONS_CURSOR_DIR    Cursor projects directory (default: ~/.cursor/projects)
  BOONS_CODEX_DIR     Codex home directory (default: $CODEX_HOME or ~/.codex)
`

async function cmdSessionSave(args: Record<string, string>, extraFiles: string[] = []) {
  const tool = args["--tool"]
  if (!tool || !isKnownTool(tool)) {
    console.error("--tool is required. Valid tools: " + validTools().join(" | "))
    process.exit(1)
  }

  const summary = args["--summary"]
  if (!summary) {
    console.error("--summary is required. Provide a summary of what was accomplished.")
    process.exit(1)
  }

  const sessionID = args["--session-id"]
  const asJson = args["--json"] === "true"

  const result = await exportSession({ tool, sessionID, summary })

  for (const filePath of extraFiles) {
    const basename = path.basename(filePath)
    await Bun.write(path.join(result.dir, basename), Bun.file(filePath))
    if (!asJson) console.log(`  wrote ${basename}`)
  }

  if (asJson) {
    console.log(JSON.stringify(result))
  } else {
    console.log(`Saved ${result.messageCount} messages to ${result.dir}`)
  }
}

async function cmdSessionRead(args: Record<string, string>) {
  const tool = args["--tool"]
  if (!tool || !isKnownTool(tool)) {
    console.error("--tool is required. Valid tools: " + validTools().join(" | "))
    process.exit(1)
  }

  const sessionID = args["--session-id"]
  if (!sessionID) {
    console.error("--session-id is required.")
    process.exit(1)
  }

  const cwd = process.cwd()

  let sessionInfo: import("./opencode").SessionInfo
  let messages: import("./opencode").MessageEntry[]

  if (tool === "opencode") {
    const dbPath = getDefaultDBPath()
    sessionInfo = readSessionFromDB(dbPath, sessionID)
    messages = readMessagesFromDB(dbPath, sessionID)
  } else if (tool === "claude-code") {
    const projectsDir = getClaudeProjectsDir()
    sessionInfo = readClaudeSessionFromFile(projectsDir, cwd, sessionID)
    messages = readClaudeMessagesFromFile(projectsDir, cwd, sessionID)
  } else if (tool === "cursor") {
    const projectsDir = getCursorProjectsDir()
    sessionInfo = readCursorSessionFromFile(projectsDir, cwd, sessionID)
    messages = readCursorMessagesFromFile(projectsDir, cwd, sessionID)
  } else {
    const codexDir = getDefaultCodexDir()
    sessionInfo = readCodexSessionFromFile(codexDir, sessionID)
    messages = readCodexMessagesFromFile(codexDir, sessionID)
  }

  const created = sessionInfo.time.created
    ? new Date(sessionInfo.time.created).toISOString()
    : "unknown"
  const updated = sessionInfo.time.updated
    ? new Date(sessionInfo.time.updated).toISOString()
    : "unknown"

  console.log(`Session: ${sessionID}`)
  console.log(`Title: ${sessionInfo.title}`)
  console.log(`Tool: ${tool}`)
  console.log(`Created: ${created}`)
  console.log(`Updated: ${updated}`)
  console.log(`Messages: ${messages.length}`)
  console.log("")

  for (const m of messages) {
    const role = (m.info as Record<string, unknown>).role ?? "unknown"
    const ts = (m.info as Record<string, unknown>).timestamp
      ? new Date((m.info as Record<string, unknown>).timestamp as number).toISOString()
      : null
    const header = ts ? `[${role}] (${ts}):` : `[${role}]:`
    console.log(header)
    for (const part of m.parts) {
      const text = part.text ?? part.content ?? ""
      if (text) console.log(text)
    }
    console.log("")
  }
}

async function cmdLs(args: Record<string, string>) {
  const cwd = process.cwd()
  const doRemote = args["--remote"] === "true"

  if (doRemote) {
    await cmdLsRemote(args)
    return
  }

  const boonsDir = path.join(cwd, ".boons")
  const branchFilter = args["--branch"]
  const asJson = args["--json"] === "true"

  if (!fs.existsSync(boonsDir)) {
    console.log("No .boons/ directory found.")
    return
  }

  const rows: {
    branch: string
    sessionID: string
    name: string
    author: string
    created: string
    messageCount: number | null
    files: string[]
  }[] = []

  const glob = new Glob("**/info.json")

  for await (const file of glob.scan(boonsDir)) {
    const parts = file.split("/")
    const branch = parts.slice(0, -2).join("/")
    const sessionID = parts[parts.length - 2]

    if (branchFilter && branch !== branchFilter) continue

    const sessionPath = path.join(boonsDir, branch, sessionID)
    const info = JSON.parse(
      await Bun.file(path.join(sessionPath, "info.json")).text(),
    )

    const entries = fs.readdirSync(sessionPath)
    const extras = entries.filter(
      (f) => f !== "info.json" && f !== "raw.jsonl",
    )

    rows.push({
      branch,
      sessionID,
      name: info.name ?? "",
      author: info.author ?? "",
      created: info.created
        ? new Date(info.created).toISOString()
        : "",
      messageCount: info.messageCount ?? null,
      files: extras,
    })
  }

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2))
    return
  }

  if (rows.length === 0) {
    console.log("No saved sessions found.")
    return
  }

  const branchWidth = Math.max(...rows.map((r) => r.branch.length), 6)
  const nameWidth = Math.max(...rows.map((r) => r.name.length), 4)
  const authorWidth = Math.max(...rows.map((r) => r.author.length), 6)

  const header = [
    "Branch".padEnd(branchWidth),
    "Session ID".padEnd(28),
    "Name".padEnd(nameWidth),
    "Msgs".padEnd(5),
    "Author".padEnd(authorWidth),
    "Files",
  ].join("  ")

  console.log(header)
  console.log("─".repeat(header.length))

  for (const r of rows) {
    const sid = r.sessionID.length > 26
      ? r.sessionID.slice(0, 23) + "..."
      : r.sessionID
    console.log(
      [
        r.branch.padEnd(branchWidth),
        sid.padEnd(28),
        r.name.padEnd(nameWidth),
        (r.messageCount?.toString() ?? "?").padEnd(5),
        r.author.padEnd(authorWidth),
        r.files.join(", "),
      ].join("  "),
    )
  }
}

async function cmdLsRemote(args: Record<string, string>) {
  const asJson = args["--json"] === "true"
  const branch = args["--branch"]

  try {
    const sessions = await listRemote({ branch })

    if (asJson) {
      console.log(JSON.stringify(sessions, null, 2))
      return
    }

    if (sessions.length === 0) {
      const label = branch ? `branch "${branch}"` : "the current branch"
      console.log(`No remote sessions found for ${label}.`)
      return
    }

    const nameWidth = Math.max(...sessions.map((r) => r.name.length), 4)
    const authorWidth = Math.max(...sessions.map((r) => r.author.length), 6)

    const header = [
      "Session ID".padEnd(28),
      "Name".padEnd(nameWidth),
      "Msgs".padEnd(5),
      "Author".padEnd(authorWidth),
    ].join("  ")

    console.log(header)
    console.log("─".repeat(header.length))

    for (const r of sessions) {
      const sid = r.sessionID.length > 26
        ? r.sessionID.slice(0, 23) + "..."
        : r.sessionID
      console.log(
        [
          sid.padEnd(28),
          r.name.padEnd(nameWidth),
          (r.messageCount?.toString() ?? "?").padEnd(5),
          r.author.padEnd(authorWidth),
        ].join("  "),
      )
    }
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}

function getGlobalGitignorePath(): string {
  try {
    const buf = Bun.spawnSync(["git", "config", "--global", "core.excludesfile"])
    const resolved = buf.stdout.toString().trim()
    if (resolved) return resolved
  } catch {}
  return path.join(os.homedir(), ".config", "git", "ignore")
}

function addBoonsToGitignore(scope: "global" | "project") {
  const gitignorePath = scope === "global"
    ? getGlobalGitignorePath()
    : path.join(process.cwd(), ".gitignore")

  const gitignoreContent = (() => {
    try { return fs.readFileSync(gitignorePath, "utf-8") } catch { return "" }
  })()

  const lines = gitignoreContent.split("\n")
  const hasBoons = lines.some((l) => l.trim() === ".boons/")
  const hasException = lines.some((l) => l.trim() === "!.boons/config.json")

  let updated = gitignoreContent
  if (!hasException && hasBoons) {
    updated = updated.replace(".boons/", ".boons/\n!.boons/config.json")
  } else if (!hasBoons) {
    updated = (updated.endsWith("\n") ? updated : updated + "\n") + ".boons/\n!.boons/config.json\n"
  }
  if (updated !== gitignoreContent) {
    fs.mkdirSync(path.dirname(gitignorePath), { recursive: true })
    fs.writeFileSync(gitignorePath, updated)
    console.log(`Updated ${scope === "global" ? "global" : "project"} .gitignore with .boons/ entries`)
  }
}

async function askRemoteConfig(skipConfirm = false): Promise<RemoteConfig | null> {
  if (!skipConfirm) {
    const answer = await ask("Configure cloud remote for sharing sessions? (y/N)")
    if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") return null
  }

  const provider = await ask("Cloud provider (aws/gcp/azure):")
  const valid = ["aws", "gcp", "azure"]
  if (!valid.includes(provider)) {
    console.log(`Skipping: unsupported provider "${provider}". Use aws, gcp, or azure.`)
    return null
  }

  const remote: Record<string, string> = { provider }

  if (provider === "aws") {
    const bucket = await askRequired("AWS S3 bucket name:", "Bucket name")
    remote.bucket = bucket
    const region = await ask("AWS region (optional, press Enter to skip):")
    if (region) remote.region = region
  } else if (provider === "gcp") {
    const bucket = await askRequired("GCS bucket name:", "Bucket name")
    remote.bucket = bucket
  } else if (provider === "azure") {
    const account = await askRequired("Azure storage account name:", "Account name")
    remote.account = account
    const container = await askRequired("Azure container name:", "Container name")
    remote.container = container
  }

  const prefix = await ask("Key prefix (optional, press Enter to skip):")
  if (prefix) remote.prefix = prefix

  return remote as RemoteConfig
}

function writeConfigTarget(target: "per-repo" | "repo-keyed" | "global-default", config: Config, cwd: string): void {
  if (target === "global-default") {
    const globalCfg = readGlobalConfig()
    globalCfg.default = config.remote!
    writeGlobalConfig(globalCfg)
    console.log("Wrote to ~/.config/boons/config.json (default)")
  } else if (target === "repo-keyed") {
    const repoKey = getRepoKey(cwd)
    if (!repoKey) {
      console.error("No git remote origin found. Cannot write repo-keyed global config.")
      process.exit(1)
    }
    const globalCfg = readGlobalConfig()
    if (!globalCfg.repos) globalCfg.repos = {}
    globalCfg.repos[repoKey] = config.remote!
    writeGlobalConfig(globalCfg)
    console.log(`Wrote to ~/.config/boons/config.json (repos.${repoKey})`)
  } else {
    writeConfig(config, cwd)
  }
}

async function cmdInstall(tool: string, args: Record<string, string>) {
  if (!isKnownTool(tool)) {
    console.error(`Unknown tool: "${tool}". Supported: ${validTools().join(", ")}`)
    process.exit(1)
  }

  const projectDir = args["--project"] === "true" ? process.cwd() : undefined

  if (tool === "opencode") {
    await installOpenCode(projectDir)
  } else if (tool === "claude-code") {
    await installClaudeCode(projectDir)
  } else if (tool === "cursor") {
    await installCursor(projectDir)
  } else if (tool === "codex") {
    await installCodex(projectDir)
  }

  const info = tools[tool]

  if (projectDir) {
    addBoonsToGitignore("project")
    addRulesPointer(path.join(process.cwd(), info.projectRulesFile))
  } else {
    addBoonsToGitignore("global")
    if (info.globalRulesFile) {
      addRulesPointer(path.join(os.homedir(), info.globalRulesFile))
    } else {
      console.log("Cursor stores global rules in its internal database.")
      console.log("Open Settings > Rules > User Rules and paste:")
      console.log("")
      console.log("<!-- boons -->")
      console.log("# boons")
      console.log("")
      console.log("Before committing, pushing, or switching branches — and every ~15")
      console.log("messages — load the boons-session-save skill and follow its guidance.")
      console.log("")
      console.log("Before running any project command (install, build, test, deploy, etc.),")
      console.log("load the boons-task skill and run `boons task --list` to check for an")
      console.log("existing script. Use `boons task <name>` instead of running commands")
      console.log("directly. When you discover new commands, save them as task scripts.")
      console.log("")
      console.log("Also available: boons-session-load (prior context), boons-session-push (share")
      console.log("to cloud), boons-session-pull (fetch from cloud), boons-pr-draft (PR")
      console.log("descriptions), boons-pr-review (PR reviews), boons-task (project task runner).")
      console.log("<!-- /boons -->")
    }
  }
}

function addRulesPointer(filePath: string) {
  const block = [
    "<!-- boons -->",
    "# boons",
    "",
    "Before committing, pushing, or switching branches — and every ~15",
    "messages — load the boons-session-save skill and follow its guidance.",
    "",
    "Before running any project command (install, build, test, deploy, etc.),",
    "load the boons-task skill and run `boons task --list` to check for an",
    "existing script. Use `boons task <name>` instead of running commands",
    "directly. When you discover new commands, save them as task scripts.",
    "",
    "Also available: boons-session-load (prior context), boons-session-push (share",
    "to cloud), boons-session-pull (fetch from cloud), boons-pr-draft (PR",
    "descriptions), boons-pr-review (PR reviews), boons-task (project task runner).",
    "<!-- /boons -->",
    "",
  ].join("\n")

  const existing = (() => {
    try { return fs.readFileSync(filePath, "utf-8") } catch { return "" }
  })()

  // Exact block already present — nothing to do
  if (existing.includes(block)) return

  let updated: string

  // Check for marker-delimited boons section
  const endMarker = "<!-- /boons -->"
  const endIdx = existing.indexOf(endMarker)
  if (endIdx >= 0) {
    const startMarker = "<!-- boons -->"
    const startIdx = existing.lastIndexOf(startMarker, endIdx)
    const replaceStart = startIdx >= 0 ? startIdx : existing.lastIndexOf("\n", endIdx - 1) + 1
    updated = existing.slice(0, replaceStart) + block + existing.slice(endIdx + endMarker.length)
  } else {
    // Check for old-format boons section (no markers)
    const boonsLine = existing.indexOf("\n# boons\n")
    const hasOldBoons = boonsLine >= 0 || existing.startsWith("# boons\n")
    if (hasOldBoons) {
      const start = boonsLine >= 0 ? boonsLine + 1 : 0
      const rest = existing.slice(start + 7)
      const nextHeading = rest.search(/\n(?=# )/)
      const sectionEnd = nextHeading >= 0 ? start + 7 + nextHeading + 1 : existing.length
      updated = existing.slice(0, start) + block + existing.slice(sectionEnd)
    } else {
      // No boons section — append
      updated = existing === "" || existing.endsWith("\n")
        ? existing + block
        : existing + "\n" + block
    }
  }

  if (updated !== existing) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, updated)
    console.log(`Added boons rule to ${path.basename(filePath)}`)
  }
}

function ensureBoonsOnPath() {
  const currentBin = path.resolve(import.meta.dir, "..", "bin", "boons")
  const localBin = path.join(os.homedir(), ".local", "bin")
  const linkPath = path.join(localBin, "boons")

  if (fs.existsSync(linkPath)) {
    try {
      const target = fs.realpathSync(linkPath)
      if (target === currentBin) return
      fs.unlinkSync(linkPath)
    } catch {
      fs.unlinkSync(linkPath)
    }
  }

  fs.mkdirSync(localBin, { recursive: true })
  fs.symlinkSync(currentBin, linkPath)
  console.log(`Symlinked boons to ${linkPath}`)

  const pathDirs = (process.env.PATH || "").split(":")
  if (!pathDirs.includes(localBin)) {
    addLocalBinToPath(localBin)
  }
}

function addLocalBinToPath(localBin: string) {
  const exportLine = `export PATH="${localBin}:$PATH"`

  const candidates = [
    path.join(os.homedir(), ".profile"),
    path.join(os.homedir(), ".bashrc"),
    path.join(os.homedir(), ".zshrc"),
  ]

  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const content = fs.readFileSync(file, "utf-8")
    if (content.includes(exportLine)) return
    const updated = content.endsWith("\n") ? `${content}${exportLine}\n` : `${content}\n${exportLine}\n`
    fs.writeFileSync(file, updated)
    console.log(`Added ${localBin} to PATH in ${file}`)
    return
  }

  console.log(`Add ${localBin} to your PATH:\n  ${exportLine}`)
}

interface ToolInfo {
  flag: string
  label: string
  name: string
  globalDir: string
  projectDir: string
  extraSave: string
  projectRulesFile: string
  globalRulesFile: string
}

const tools: Record<string, ToolInfo> = {
  opencode: {
    flag: "opencode",
    label: "OpenCode",
    name: "session",
    globalDir: path.join(os.homedir(), ".config", "opencode", "skills"),
    projectDir: ".opencode/skills",
    extraSave: "",
    projectRulesFile: "AGENTS.md",
    globalRulesFile: ".config/opencode/AGENTS.md",
  },
  "claude-code": {
    flag: "claude-code",
    label: "Claude Code",
    name: "boons-session",
    globalDir: path.join(os.homedir(), ".claude", "skills"),
    projectDir: ".claude/skills",
    extraSave: "",
    projectRulesFile: "CLAUDE.md",
    globalRulesFile: ".claude/CLAUDE.md",
  },
  cursor: {
    flag: "cursor",
    label: "Cursor",
    name: "boons-session",
    globalDir: path.join(os.homedir(), ".cursor", "skills"),
    projectDir: ".cursor/skills",
    extraSave: `   Use \`--session-id\` to target a specific session, or omit to auto-detect
   the most recent one. The session ID is the UUID shown in the ${"Cursor"} chat panel.
   Pass \`--summary\` as a single quoted string on one line — do not use heredocs
   or command substitution (\`\$(cat <<EOF...EOF)\`), which hang in non-interactive shells.`,
    projectRulesFile: ".cursorrules",
    globalRulesFile: "",
  },
  codex: {
    flag: "codex",
    label: "Codex",
    name: "session",
    globalDir: path.join(os.homedir(), ".agents", "skills"),
    projectDir: ".agents/skills",
    extraSave: "",
    projectRulesFile: "AGENTS.md",
    globalRulesFile: ".codex/AGENTS.md",
  },
}

function saveSkillContent(t: ToolInfo): string {
  return `---
name: boons-session-save
description: "Auto-save at natural stopping points: before commits, before branch switches, every ~15 messages, or when user is satisfied. Do NOT ask."
---

## What this does

Export the current chat session to the \`.boons/\` artifact directory.
Each export creates a session directory containing:

- \`raw.jsonl\` — the complete message history in native format
- \`info.json\` — metadata (session name, author, branch, participants, timestamps)
- \`summary.md\` — a summary you auto-generate when saving
- Any other files you include via \`--file\` (plan.md, decisions.md, etc.)

## When to use this — be proactive

Run \`boons session-save --tool ${t.flag} --summary "..."\` **automatically**
(no need to ask the user) when:

- **You modified files** — after writing code that changes multiple files,
  add a commit, or fix a bug. You know work happened; save it.
- **The user expresses satisfaction** — "that works", "looks good", "great",
  "thanks". Treat this as a close signal worth capturing.
- **Every ~15 messages** of activity involving file changes — save a checkpoint
  so the session history is never more than a few exchanges behind.
- **A git commit is made** — if you were involved in the commit, save first
  so the session matches the commit.
- **Before creating a branch** — save before running \`git checkout -b\` or
  \`git branch\` to capture the exploration that led to it.
- **The user explicitly asks** — always.

Do NOT auto-save on trivial exchanges (single-line suggestions, yes/no
answers, README-only typos). Use judgment.

After saving, optionally ask: "Want me to push this to the team so they
can see the context?" — this turns auto-save into a natural prompt for
sharing without being automatic.

## Branch awareness

Before saving, check the current branch with \`git rev-parse --abbrev-ref HEAD\`:

- If on \`main\`, \`master\`, or \`HEAD\` (detached), flag it to the user.
  Sessions on default branches can get mixed in with stable history.
  Suggest creating a feature branch: \`git checkout -b <branch-name>\`.
  Don't block — let the user decide (hotfixes, docs, etc. happen on main).
- When starting a new task, suggest branching first if the user is on \`main\`.
- When the user is about to switch branches, save the current session first
  so context is captured on the right branch.
## Using the command

1. Run \`boons session-read --tool ${t.flag}\` to review the conversation
   before writing anything — the session ID can be discovered from
   \`boons ls\` or provided by the user.
2. Based on your review, compose a thorough summary and any additional
   docs (plan.md, decisions.md, etc.) — write them as local files, or
   reference existing files the user has already authored.

   Keep your summary **concise** — it's the primary way sessions are
   discovered later. Focus on: what was accomplished, key decisions,
   files changed, and what's still open or uncertain. Future agents
   read this summary first to decide if the full session is relevant.
3. Run \`boons session-save --tool ${t.flag} --summary "<summary>" \\
      --file /path/to/summary.md [--file /path/to/plan.md]\`
   Use \`--file\` for each authored file to copy into the session directory
   alongside the auto-generated export (raw.jsonl, info.json, summary.md from --summary).

The \`--session-id\` flag is optional — when omitted, boons automatically
detects the most recent session for the current project. Pass \`--session-id\`
explicitly to target a different session.

You may also optionally create:

- \`plan.md\` — if the session included planning or design discussions,
  document the current intent and next steps
- \`decisions.md\` — if specific architectural or design decisions were
  settled, list them with rationale
- Any other docs the user asks for or that you think would be useful
  to someone loading this session later

These are human-readable markdown files meant to be reviewed with the
user before sharing. The session directory is the canonical home
for all artifacts related to a session.
`
}

function loadSkillContent(t: ToolInfo): string {
  return `---
name: boons-session-load
description: Load prior context on branch switch, before new features, or when drafting PRs. Read .boons/ session summaries.
---

## What this does

Guides the agent in discovering and using saved session artifacts
from the \`.boons/\` directory to understand prior work on a branch.

## Available files per session

Every saved session directory (\`.boons/<branch>/<session-id>/\`) contains:

- \`info.json\` — metadata (name, author, participants, timestamps)
- \`raw.jsonl\` — complete message history in native format

Sessions may also have additional files generated after export:

- \`summary.md\` — human-readable summary of what was accomplished,
  key decisions made, and what remains uncertain
- \`plan.md\` — current intent, design approach, and next steps
- \`decisions.md\` — architectural or design decisions with rationale
- Any other docs the author created

To see which files are present for a particular session, list its directory.

## Protocols

### On branch checkout or creation

When the user switches to or creates a branch, proactively check for
existing context:

1. Run \`boons ls [--branch <name>]\` to discover saved sessions
2. Read \`summary.md\` from **every session** on the branch to
   understand the full narrative arc — skim all summaries, then
   decide which sessions need a deeper look via \`raw.jsonl\`
3. Also read \`plan.md\` and \`decisions.md\` if present
4. Orient the user: "Sessions on this branch worked on X, Y, Z.
   Key decisions so far: A. Still open or uncertain: B."
5. If the new branch has no sessions, check for sessions on the branch
   you came from or on \`main\`/\`master\`. Run \`boons ls --branch <name>\`
   to discover relevant context.

This gives the user a running start — they don't have to re-explain
where things stand.

### Starting a new session or feature

When the user begins describing a new task or feature to work on:

1. Run \`boons ls\` to see all sessions on the current branch
2. Read \`summary.md\` from every session — don't assume the most
   recent session covers it. Skim all summaries to find context
   relevant to the new task.
3. Use that context to ground your response — don't act like a blank
   slate. Reference prior decisions and open questions so the work
   feels continuous.

### Drafting a PR description

When asked to draft or help write a PR description:

1. Run \`boons ls [--branch <name>]\` to discover all sessions
2. Read \`summary.md\` and \`decisions.md\` from every session
3. Cross-reference decisions across sessions to identify what was
   settled and what changed direction midstream
4. Collect all open questions and uncertainties from summaries
5. Draft a PR with sections: what changed, why, key decisions made,
   alternatives considered, open questions

### Reviewing or understanding a branch

When asked to review a branch or understand someone else's work:

1. Run \`boons ls [--branch <name>]\` for the branch
2. Read all summaries to get the narrative arc of the branch — how
   the code evolved across sessions, not just the final state
3. For sessions that mention specific design decisions, read
   \`decisions.md\`
4. Generate a synthesis: overall purpose, what was built, design
   decisions with rationale, open questions

### Finding specific context

When the user asks about a specific feature, bug, or decision:

1. Run \`boons ls\` on the current branch
2. Skim \`summary.md\` from all sessions — look for keywords
   matching the topic
3. If no match found, search other branches with
   \`boons ls --branch <name>\` and skim their summaries
4. For promising sessions, read \`raw.jsonl\` for full detail

If \`summary.md\` files are sparse and \`raw.jsonl\` exists, you may
read the raw logs directly to fill in gaps — but prefer summaries
as the starting point.
`
}

function pushSkillContent(t: ToolInfo): string {
  return `---
name: boons-session-push
description: Ask to share after auto-save, before git push, or before PR review. Push .boons/ to cloud. Always ask user.
---

## What this does

Uploads local session artifacts for the current branch to the configured
cloud bucket. This makes sessions visible to teammates who pull from the
same bucket.

## When to use this

Run \`boons push\` when:
- The user explicitly asks to share or push sessions
- **After auto-saving a session** — ask if they want to push this to the team
- Before pushing to the remote repository — ask the user
- Before creating or marking a PR as ready for review — ask the user

**Always ask the user before running** — this shares session data with others.
## Before first push

Object versioning on your cloud bucket is **recommended** — it gives you
the ability to recover from accidental overwrites since boons doesn't
prevent overwriting sessions.

## Default behavior

\`boons push\` pushes all sessions for the current branch by default. Use
the \`--branch\` and \`--session-id\` arguments explicitly only when you need to
push sessions from a different context.

## Selective sharing

If a session contains sensitive or irrelevant content, you may be asked to
curate it before pushing. Remove private messages from the session's
\`raw.jsonl\` and update \`info.json\` as needed. The push command will upload
whatever is in the local session directory.
`
}

function pullSkillContent(t: ToolInfo): string {
  return `---
name: boons-session-pull
description: Fetch remote context after git pull or before code review. Pull .boons/ from cloud.
---

## What this does

Downloads session artifacts for the current branch from the configured
cloud bucket. This is how a collaborator or reviewer fetches context
created by others.

## When to use this

Run \`boons pull\` when:
- The user explicitly asks to fetch remote sessions
- After pulling from the remote repository — suggest it
- Before reviewing work on a branch — suggest fetching context from collaborators

## Workflow

1. First run \`boons ls --remote\` to see what sessions exist for the
   current branch
2. Then run \`boons pull\` to fetch them into \`.boons/<branch>/\`
3. After pulling, use the boons-session-load guidance to read them

## Default behavior

\`boons pull\` pulls all sessions for the current branch by default. Use the
\`--branch\` argument to pull sessions from a different branch context, or
  \`--session-id\` to pull a specific session.
`
}

function prDraftSkillContent(t: ToolInfo): string {
  return `---
name: boons-pr-draft
description: When drafting a PR, load boons session context from the branch to ground the description in session history.
---

## What this does

Guides the agent to use boons session artifacts when drafting a PR,
so the description reflects the full narrative arc — not just the diff.

## Protocol

When the user asks you to draft a PR, create a PR, or write a PR description:

1. **Discover sessions** — run \`boons ls [--branch <name>]\` for the branch
   (defaults to current branch)
2. **Load context** — read \`summary.md\`, \`plan.md\`, and \`decisions.md\` from
   every session on the branch
3. **Cross-reference** — identify what was settled, what changed direction
   midstream, and what's still open
4. **Draft** — produce a PR description with sections: what changed, why,
   key decisions with rationale, alternatives considered, open questions
5. **Present to the user** — do not post the PR automatically. Let the user
   review and edit the draft.

## Relationship to session-load

This skill activates the "Drafting a PR description" protocol from the
boons-session-load skill. Refer to boons-session-load for the full
context-loading workflow.
`
}

function prReviewSkillContent(t: ToolInfo): string {
  return `---
name: boons-pr-review
description: When reviewing a PR or branch, load boons context to understand the intent behind changes.
---

## What this does

Guides the agent to load boons session context before reviewing code,
so the review evaluates intent vs. execution — not just line-level
correctness.

## Protocol

When the user asks you to review a PR, review a branch, or understand
someone else's work:

1. **Fetch context** — if the branch has remote sessions, suggest
   \`boons pull\` to fetch them first
2. **Discover sessions** — run \`boons ls [--branch <name>]\` for the branch
3. **Load context** — read \`summary.md\`, \`plan.md\`, and \`decisions.md\` from
   every session
4. **Synthesize** — understand the overall purpose, what was built, design
   rationale, and open questions
5. **Review the diff** — examine the actual code changes with that context.
   Flag places where the implementation diverges from the plan or where
   intent is unclear
6. **Present the review to the user** — do not post it automatically via
   \`gh pr review\`. Let the user decide when and how to share.

## Relationship to session-load

This skill activates the "Reviewing or understanding a branch" protocol
from the boons-session-load skill. Refer to boons-session-load for the full
context-loading workflow.
`
}

function taskSkillContent(): string {
  return `---
name: boons-task
description: >
  Project task runner. Always check \`boons task --list\` before running any
  project command (install, build, test, deploy, etc.). Use \`boons task <name>\`
  instead of running commands directly. Save discovered commands as scripts.
---

## When to load this skill

Load this skill whenever you are about to run any project-level command:
\`npm install\`, \`bun run\`, \`pip install\`, \`make\`, \`cargo\`, \`go build\`,
\`docker compose\`, or similar. First check if a task script exists.

## What this does

Manages per-project task scripts at \`~/.config/boons/projects/<repo-key>/scripts/\`.
Scripts are shell scripts that survive agent sessions — useful when usage caps
interrupt work mid-task.

## Commands

| Command | Behavior |
|---|---|
| \`boons task\` | Run \`setup.sh\` silently; log to \`.logs/setup.log\` |
| \`boons task <name>\` | Run \`<name>.sh\` silently; log to \`.logs/<name>.log\` |
| \`boons task <name> --verbose\` | Run with live terminal output |
| \`boons task read <name>\` | Print task output (excluding status header) |
| \`boons task read <name> --status\` | Print exit code (0 = success) |
| \`boons task --list\` | List available scripts with descriptions |
| \`boons task --check\` | Print script content without executing |
| \`boons task --path\` | Print scripts directory path |
| \`boons task --env\` | Open/create \`.env\` in \$EDITOR |

## Protocol

1. **Before running any project command** → run \`boons task --list\` first
2. **If a matching script exists** → use \`boons task <name>\` instead
3. **If no matching script** → run the command directly, then save it as a task script
4. **After running** → check status with \`boons task read <name> --status\`
5. **If the command changes** → update the script

## When to create task scripts

Write a new script when you discover a repeatable project command:

- **Setup**: package install, git hooks, env file init → \`setup.sh\`
- **Build**: compile, bundle, typecheck → \`build.sh\`
- **Test**: unit tests, integration tests, linting → \`test.sh\`
- **Deploy**: deploy to staging/production → \`deploy.sh\`
- **Seed**: database migrations, test data → \`seed.sh\`
- **Dev**: run dev server, watch mode → \`dev.sh\`

Don't write scripts for one-off commands (ephemeral debugging, single
investigations). Only save commands that someone (including a future you)
would need to run again.

### Script format

    #!/bin/bash
    # One-line description shown by --list
    set -euo pipefail

    echo "Hello from my task"

- First \`#\` comment after optional shebang is the \`--list\` description
- \`set -euo pipefail\` is recommended to fail fast
- \`.env\` vars are sourced automatically before execution

## When to iterate (update)

Update an existing script when:

- Package manager changed (npm → pnpm, pip → uv, etc.)
- Build/test commands changed
- Environment variables were added or renamed
- The script failed and you fixed it

Overwrite the file in place. The \`--check\` flag lets you review what's
there before running.

## Inspection

After running a task, use \`boons task read <name>\` to see output without
re-executing. Use \`boons task read <name> --status\` to check success
before deciding whether to read the full log.

Logs live at \`~/.config/boons/projects/<repo-key>/.logs/<name>.log\` with
a \`# exit: <code>\` header on the first line.
`
}

async function writeSkills(t: ToolInfo, rootDir: string) {
  const skills = [
    { name: "boons-session-save", content: saveSkillContent(t) },
    { name: "boons-session-load", content: loadSkillContent(t) },
    { name: "boons-session-push", content: pushSkillContent(t) },
    { name: "boons-session-pull", content: pullSkillContent(t) },
    { name: "boons-pr-draft", content: prDraftSkillContent(t) },
    { name: "boons-pr-review", content: prReviewSkillContent(t) },
    { name: "boons-task", content: taskSkillContent() },
  ]

  for (const skill of skills) {
    const dir = path.join(rootDir, skill.name)
    fs.mkdirSync(dir, { recursive: true })
    await Bun.write(path.join(dir, "SKILL.md"), skill.content)
  }

  console.log(`Installed boons skills to ${rootDir}`)
}

async function installOpenCode(projectDir?: string) {
  const root = projectDir
    ? path.join(projectDir, tools.opencode.projectDir)
    : tools.opencode.globalDir
  await writeSkills(tools.opencode, root)
  ensureBoonsOnPath()
}

async function installClaudeCode(projectDir?: string) {
  const root = projectDir
    ? path.join(projectDir, tools["claude-code"].projectDir)
    : tools["claude-code"].globalDir
  await writeSkills(tools["claude-code"], root)
  ensureBoonsOnPath()
}

async function installCursor(projectDir?: string) {
  const root = projectDir
    ? path.join(projectDir, tools.cursor.projectDir)
    : tools.cursor.globalDir
  await writeSkills(tools.cursor, root)
  ensureBoonsOnPath()
}

async function installCodex(projectDir?: string) {
  const root = projectDir
    ? path.join(projectDir, tools.codex.projectDir)
    : tools.codex.globalDir
  await writeSkills(tools.codex, root)
  ensureBoonsOnPath()
}

async function cmdRemote(args: Record<string, string>) {
  const cwd = process.cwd()
  const target = args["--project"] === "true" ? "per-repo" : "global-default"
  const hasProviderFlags = args["--provider"] || args["--bucket"] || args["--account"] || args["--container"]

  if (hasProviderFlags) {
    const remote: Record<string, string> = { provider: args["--provider"] || "" }
    if (args["--bucket"]) remote.bucket = args["--bucket"]
    if (args["--region"]) remote.region = args["--region"]
    if (args["--account"]) remote.account = args["--account"]
    if (args["--container"]) remote.container = args["--container"]
    if (args["--prefix"]) remote.prefix = args["--prefix"]
    writeConfigTarget(target, { remote: remote as any }, cwd)
    console.log(`Configured remote: ${args["--provider"]}${remote.bucket ? ` (bucket: ${remote.bucket})` : ""}${remote.account ? ` (account: ${remote.account})` : ""}`)
    return
  }

  const resolved = resolveConfig()
  if (resolved) {
    console.log(`Source: ${resolved.source}`)
    console.log(JSON.stringify(resolved.remote, null, 2))
    return
  }

  const answer = await ask("Configure cloud remote for sharing sessions? (y/N)")
  if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
    const remote = await askRemoteConfig(true)
    if (remote) {
      writeConfigTarget(target, { remote }, cwd)
      console.log(`Configured remote: ${remote.provider}${remote.bucket ? ` (bucket: ${remote.bucket})` : ""}${remote.account ? ` (account: ${remote.account})` : ""}`)
    }
  }
}

async function cmdPush(args: Record<string, string>) {
  const asJson = args["--json"] === "true"
  const sessionID = args["--session-id"]
  const branch = args["--branch"]

  try {
    const result = await push({ sessionID, branch })
    if (asJson) {
      console.log(JSON.stringify(result))
    } else {
      console.log(`Pushed ${result.pushed} session(s) for branch "${result.branch}"`)
      for (const s of result.sessions) {
        console.log(`  ${s}`)
      }
    }
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}

async function cmdPull(args: Record<string, string>) {
  const asJson = args["--json"] === "true"
  const sessionID = args["--session-id"]
  const branch = args["--branch"]

  try {
    const result = await pull({ sessionID, branch })
    if (asJson) {
      console.log(JSON.stringify(result))
    } else {
      console.log(`Pulled ${result.pulled} session(s) for branch "${result.branch}"`)
      for (const s of result.sessions) {
        console.log(`  ${s}`)
      }
    }
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }
}

async function cmdTask(args: string[]) {
  const cwd = process.cwd()
  const repoKey = getRepoKey(cwd)
  if (!repoKey) {
    console.error("Not in a git repository with a remote origin.")
    process.exit(1)
  }

  const opts = parseArgs(args.slice(1))
  const sub = args[0]
  const verbose = opts["--verbose"] === "true"
  const baseDir = opts["--base"] as string | undefined

  if (!sub || sub.startsWith("--")) {
    // No subcommand — run setup.sh
    if (sub === "--list") {
      printScripts(repoKey, baseDir)
      return
    }
    if (sub === "--check") {
      printCheck(repoKey, baseDir)
      return
    }
    if (sub === "--path") {
      printPath(repoKey, baseDir)
      return
    }
    if (sub === "--env") {
      handleEnv(repoKey, baseDir)
      return
    }
    if (sub === "--verbose") {
      // run setup.sh with verbose
      const script = getScript(repoKey, "setup", baseDir)
      if (!script) {
        console.log("No default task script (setup.sh) found.")
        return
      }
      const result = runScript(repoKey, "setup", { verbose: true, baseDir })
      if (result.output) console.log(result.output)
      return
    }
    // No flags — run setup.sh
    const script = getScript(repoKey, "setup", baseDir)
    if (!script) {
      console.log("No default task script (setup.sh) found.")
      return
    }
    runScript(repoKey, "setup", { verbose: false, baseDir })
    return
  }

  if (sub === "read") {
    const name = args[1]
    if (!name) {
      console.error("Usage: boons task read <name> [--status]")
      process.exit(1)
    }
    if (opts["--status"] === "true") {
      const status = readStatus(repoKey, name, baseDir)
      if (status === null) {
        console.log(`No log found for task "${name}".`)
      } else {
        console.log(status)
      }
      return
    }
    const log = readLog(repoKey, name, baseDir)
    if (log === null) {
      console.log(`No log found for task "${name}".`)
      return
    }
    process.stdout.write(log)
    return
  }

  // Run named script
  const script = getScript(repoKey, sub, baseDir)
  if (!script) {
    console.error(`Task script "${sub}" not found.`)
    process.exit(1)
  }
  const result = runScript(repoKey, sub, { verbose, baseDir })
  if (result.output) console.log(result.output)
  process.exit(result.exitCode)
}

function parseArgs(args: string[]): Record<string, string | string[]> {
  const opts: Record<string, string | string[]> = {}
  const repeatable = new Set(["--file"])
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith("--")) {
      const val = args[i + 1]
      if (val !== undefined && !val.startsWith("--")) {
        if (repeatable.has(a)) {
          if (!opts[a]) opts[a] = []
          ;(opts[a] as string[]).push(val)
        } else {
          opts[a] = val
        }
        i++
      } else {
        opts[a] = "true"
      }
    } else if (a.startsWith("-") && a.length === 2) {
      opts[a] = "true"
    }
  }
  return opts
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP)
    return
  }

  const cmd = args[0]
  const opts = parseArgs(args.slice(1))

  const extraFiles = Array.isArray(opts["--file"]) ? opts["--file"] as string[] : opts["--file"] ? [opts["--file"] as string] : []

  switch (cmd) {
    case "session-read":
      await cmdSessionRead(opts as Record<string, string>)
      break
    case "session-save":
      await cmdSessionSave(opts as Record<string, string>, extraFiles)
      break
    case "ls":
      await cmdLs(opts)
      break
    case "install":
      const tool = args.slice(1).find(a => !a.startsWith("-"))
      if (!tool) {
        console.log(HELP)
        process.exit(1)
      }
      await cmdInstall(tool, opts)
      break
    case "remote":
      await cmdRemote(opts)
      break
    case "push":
      await cmdPush(opts)
      break
    case "pull":
      await cmdPull(opts)
      break
    case "task":
      const taskArgs = args.slice(1)
      await cmdTask(taskArgs)
      break
    default:
      console.error(`Unknown command: ${cmd}`)
      console.log(HELP)
      process.exit(1)
  }
}

main()
