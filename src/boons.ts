import * as path from "path"
import * as fs from "fs"
import * as os from "os"
import * as readline from "node:readline"
import { Glob } from "bun"
import { exportSession, isKnownTool, validTools } from "./export"
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
  boons session-save --tool <name> [--session-id <id>] [--summary <text>] [--json]
                                                      Save session to .boons/
  boons ls [--branch <name>] [--json]                 List saved sessions
  boons ls --remote [--branch <name>] [--json]        List remote sessions
  boons install <tool>                                Install skills globally for a tool (+ global .gitignore)
  boons install <tool> --project                      Install skills scoped to the project (+ project .gitignore)
  boons remote                                        Show remote config, or prompt if none
  boons remote --provider aws|gcp|azure ...           Configure cloud remote
  boons remote --project --provider aws|gcp|azure ... Configure cloud remote per-project
  boons push [--session-id <id>] [--branch <b>]       Push sessions to cloud
  boons pull [--session-id <id>] [--branch <b>]       Pull sessions from cloud
  boons --help                                        Show this message

Remote flags:
  --provider aws|gcp|azure  Cloud provider
  --bucket <name>           Bucket name (aws/gcp)
  --region <name>           AWS region
  --account <name>          Azure storage account
  --container <name>        Azure container
  --prefix <path>           Optional key prefix in bucket

Options:
  --tool <name>       Tool to export from (opencode | claude-code | cursor)
  --summary <text>    Session summary (required for export)
  --session-id <id>   Session to export/push/pull (default: auto-detect / all)
  --branch <name>     Filter by branch (default: current branch)
  --json              Output as JSON (for tool integration)

Tools:
  opencode       OpenAI Codex CLI plugin
  claude-code    Anthropic Claude Code skills
  cursor         Cursor MDC rules

Environment:
  BOONS_OPENCODE_DIR  OpenCode data directory (default: $XDG_DATA_HOME/opencode or ~/.local/share/opencode)
  BOONS_CLAUDE_DIR    Claude Code projects directory (default: ~/.claude/projects)
  BOONS_CURSOR_DIR    Cursor projects directory (default: ~/.cursor/projects)
`

async function cmdSessionSave(args: Record<string, string>) {
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

  if (asJson) {
    console.log(JSON.stringify(result))
  } else {
    console.log(`Saved ${result.messageCount} messages to ${result.dir}`)
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

function addBoonsToGitignore(scope: "global" | "project") {
  const gitignorePath = scope === "global"
    ? path.join(os.homedir(), ".config", "git", "ignore")
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
  }

  if (projectDir) {
    addBoonsToGitignore("project")
  } else {
    addBoonsToGitignore("global")
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
  hasInit: boolean
  extraSave: string
}

const tools: Record<string, ToolInfo> = {
  opencode: {
    flag: "opencode",
    label: "OpenCode",
    name: "session",
    globalDir: path.join(os.homedir(), ".config", "opencode", "skills"),
    projectDir: ".opencode/skills",
    hasInit: true,
    extraSave: "",
  },
  "claude-code": {
    flag: "claude-code",
    label: "Claude Code",
    name: "boons-session",
    globalDir: path.join(os.homedir(), ".claude", "skills"),
    projectDir: ".claude/skills",
    hasInit: false,
    extraSave: "",
  },
  cursor: {
    flag: "cursor",
    label: "Cursor",
    name: "boons-session",
    globalDir: path.join(os.homedir(), ".cursor", "skills"),
    projectDir: ".cursor/skills",
    hasInit: false,
    extraSave: `   Use \`--session-id\` to target a specific session, or omit to auto-detect
   the most recent one. The session ID is the UUID shown in the ${"Cursor"} chat panel.
   Pass \`--summary\` as a single quoted string on one line — do not use heredocs
   or command substitution (\`\$(cat <<EOF...EOF)\`), which hang in non-interactive shells.`,
  },
}

function saveSkillContent(t: ToolInfo): string {
  const initSection = t.hasInit ? `
## Handling uninitialized projects

If \`.boons/\` doesn't exist yet in the project root, auto-initialize by
running \`boons install --project\`. The tool handles this automatically, but check
that the command is available first.
` : ""
  const onlyUse = t.hasInit ? "" : `
Only use in projects with a \`.boons/\` directory.
`
  return `---
name: ${t.name}-save
description: Auto-save at natural stopping points: before commits, before branch switches, every ~15 messages, or when user is satisfied. Do NOT ask. Only relevant in projects with a .boons/ directory.
---

## What this does

Export the current chat session to the \`.boons/\` artifact directory.
Each export creates a session directory containing:

- \`raw.jsonl\` — the complete message history in native format
- \`info.json\` — metadata (session name, author, branch, participants, timestamps)
- \`summary.md\` — a summary you auto-generate when saving

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
${onlyUse}
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
${initSection}
## Using the command

1. Compose a concise summary of what was accomplished, key decisions made,
   and what remains uncertain
2. Run \`boons session-save --tool ${t.flag} --summary "<summary>" --session-id <id>\`
   ${t.extraSave ? t.extraSave.trim() : "Use \`--session-id\` to target a specific session, or omit to auto-detect the most recent one"}
3. After the command succeeds, read \`raw.jsonl\` in the created session
   directory and refine \`summary.md\` with any important details you missed.
   Your initial summary is written from memory; the session log gives you
   a second pass to catch specifics about files changed, error messages,
   design rationale, and more.

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
  const initSection = t.hasInit ? `
## Handling uninitialized projects

If \`.boons/\` doesn't exist in the project, it will be auto-initialized
on first session-save. But if you're suggesting a load proactively (not
in response to a user request), check that \`.boons/\` exists first
and skip the suggestion if it doesn't.
` : ""
  const onlyUse = t.hasInit ? "" : `
Only use in projects with a \`.boons/\` directory.
`
  return `---
name: ${t.name}-load
description: Load prior context on branch switch, before new features, or when drafting PRs. Read .boons/ session summaries. Only relevant in projects with a .boons/ directory.
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
${initSection}${onlyUse}
## Protocols

### On branch checkout or creation

When the user switches to or creates a branch, proactively check for
existing context:

1. Run \`boons ls [--branch <name>]\` to discover saved sessions
2. If sessions exist, read the most recent \`summary.md\`
3. Also read \`plan.md\` and \`decisions.md\` if present
4. Orient the user: "The last session was working on X. Key decisions
   so far: Y. Still open or uncertain: Z."
5. If the new branch has no sessions, check for sessions on the branch
   you came from or on \`main\`/\`master\`. Run \`boons ls --branch <name>\`
   to discover relevant context.

This gives the user a running start — they don't have to re-explain
where things stand.

### Starting a new session or feature

When the user begins describing a new task or feature to work on:

1. Check for context with \`boons ls\` on the current branch
2. Read the latest \`summary.md\` (and \`plan.md\`/\`decisions.md\`
   if present)
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

If \`summary.md\` files are sparse and \`raw.jsonl\` exists, you may
read the raw logs directly to fill in gaps — but prefer summaries
as the starting point.
`
}

function pushSkillContent(t: ToolInfo): string {
  const initSection = t.hasInit ? `
## Handling uninitialized projects

- **User explicitly asks** to push or share: just run \`boons push\`. It
  auto-initializes boons if needed.
- **Agent-proactive suggestion** (after auto-save, before push, before PR):
  first check if \`.boons/\` exists. If not, suggest running \`boons install --project\`
  instead of pushing. Always ask the user before running.
` : ""
  const onlyUse = t.hasInit ? "" : `Only use in projects with a \`.boons/\` directory. `
  return `---
name: ${t.name}-push
description: Ask to share after auto-save, before git push, or before PR review. Push .boons/ to cloud. Always ask user. Only relevant in projects with a .boons/ directory.
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

${onlyUse}**Always ask the user before running** — this shares session data with others.
${initSection}
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
  const initSection = t.hasInit ? `
## Handling uninitialized projects

- **User explicitly asks** to fetch remote sessions: just run \`boons pull\`.
  It auto-initializes boons if needed.
- **Agent-proactive suggestion** (after git pull, before review): first check
  if \`.boons/\` exists. If not, skip the suggestion or suggest running
  \`boons install --project\`.
` : ""
  const onlyUse = t.hasInit ? "" : `
Only use in projects with a \`.boons/\` directory.
`
  return `---
name: ${t.name}-pull
description: Fetch remote context after git pull or before code review. Pull .boons/ from cloud. Only relevant in projects with a .boons/ directory.
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
${onlyUse}
## Workflow

1. First run \`boons ls --remote\` to see what sessions exist for the
   current branch
2. Then run \`boons pull\` to fetch them into \`.boons/<branch>/\`
3. After pulling, use the session-load guidance to read them

## Default behavior

\`boons pull\` pulls all sessions for the current branch by default. Use the
\`--branch\` argument to pull sessions from a different branch context, or
\`--session-id\` to pull a specific session.
${initSection}`
}

async function writeSkills(t: ToolInfo, rootDir: string) {
  const skills = [
    { name: "session-save", content: saveSkillContent(t) },
    { name: "session-load", content: loadSkillContent(t) },
    { name: "session-push", content: pushSkillContent(t) },
    { name: "session-pull", content: pullSkillContent(t) },
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

function parseArgs(args: string[]): Record<string, string> {
  const opts: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith("--")) {
      const val = args[i + 1]
      if (val !== undefined && !val.startsWith("--")) {
        opts[a] = val
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

  switch (cmd) {
    case "session-save":
      await cmdSessionSave(opts)
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
    default:
      console.error(`Unknown command: ${cmd}`)
      console.log(HELP)
      process.exit(1)
  }
}

main()
