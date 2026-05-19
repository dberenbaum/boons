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
    "Use provider flags (e.g. boons init --provider gcp --bucket NAME) or run from a terminal.",
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
  boons init [-q | --quiet]                           Create .boons/ dir + update .gitignore (non-interactive)
  boons init [<provider-flags>]                       Configure cloud remote for repo
  boons install <toolname>                            Install tools + skills for a tool
  boons config                                        Show current config
  boons push [--session-id <id>] [--branch <b>]       Push sessions to cloud
  boons pull [--session-id <id>] [--branch <b>]       Pull sessions from cloud
  boons --help                                        Show this message

Provider flags (for init):
  --provider aws|gcp|azure  Cloud provider
  --bucket <name>           Bucket name (aws/gcp)
  --region <name>           AWS region
  --account <name>          Azure storage account
  --container <name>        Azure container
  --prefix <path>           Optional key prefix in bucket
  --global                  Write to ~/.config/boons/config.json (repo-keyed) instead of .boons/config.json

Options:
  --tool <name>       Tool to export from (opencode | claude-code | cursor)
  --summary <text>    Session summary (required for export)
  --session-id <id>   Session to export/push/pull (default: auto-detect / all)
  --branch <name>     Filter by branch (default: current branch)
  --json              Output as JSON (for tool integration)

Environment:
  BOONS_DB_PATH       OpenCode database path (default: $XDG_DATA_HOME/opencode/opencode.db or ~/.local/share/opencode/opencode.db)
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

  const glob = new Glob("*/*/info.json")

  for await (const file of glob.scan(boonsDir)) {
    const parts = file.split("/")
    const branch = parts[0]
    const sessionID = parts[1]

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

async function cmdInit(args: Record<string, string>) {
  const cwd = process.cwd()
  const target = args["--global"] === "true" ? "repo-keyed" : "per-repo"
  const quiet = args["-q"] === "true" || args["--quiet"] === "true"

  if (quiet) {
    const boonsDir = path.join(cwd, ".boons")
    fs.mkdirSync(boonsDir, { recursive: true })
    console.log(`Created ${boonsDir}`)
  } else {
    await configureCloud(cwd, args, target)
  }

  if (target !== "per-repo") return

  const gitignorePath = path.join(cwd, ".gitignore")
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
    fs.writeFileSync(gitignorePath, updated)
    console.log("Updated .gitignore with .boons/ entries")
  }
}

async function configureCloud(cwd: string, args: Record<string, string>, target: "per-repo" | "repo-keyed" | "global-default") {
  const providerFlag = args["--provider"]
  const hasFlags = providerFlag || args["--bucket"] || args["--account"] || args["--container"]

  if (hasFlags) {
    const remote: Record<string, string> = { provider: providerFlag || "" }
    if (args["--bucket"]) remote.bucket = args["--bucket"]
    if (args["--region"]) remote.region = args["--region"]
    if (args["--account"]) remote.account = args["--account"]
    if (args["--container"]) remote.container = args["--container"]
    if (args["--prefix"]) remote.prefix = args["--prefix"]
    writeConfigTarget(target, { remote: remote as any }, cwd)
    console.log(`Configured remote: ${providerFlag}${remote.bucket ? ` (bucket: ${remote.bucket})` : ""}${remote.account ? ` (account: ${remote.account})` : ""}`)
    return
  }

  const remote = await askRemoteConfig()
  if (!remote) return

  writeConfigTarget(target, { remote }, cwd)
  console.log(`Configured remote: ${remote.provider}${remote.bucket ? ` (bucket: ${remote.bucket})` : ""}${remote.account ? ` (account: ${remote.account})` : ""}`)
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

async function cmdInstall(tool: string) {
  if (!isKnownTool(tool)) {
    console.error(`Unknown tool: "${tool}". Supported: ${validTools().join(", ")}`)
    process.exit(1)
  }

  if (tool === "opencode") {
    await installOpenCode()
  } else if (tool === "claude-code") {
    await installClaudeCode()
  } else if (tool === "cursor") {
    await installCursor()
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
    console.log(`\nNote: Add ${localBin} to your PATH for boons to work in tools:`)
    console.log(`  export PATH="${localBin}:$PATH"`)
  }
}

async function installOpenCode() {
  const configDir = path.join(os.homedir(), ".config", "opencode")
  const toolsDir = path.join(configDir, "tools")
  const skillsDir = path.join(configDir, "skills")

  const exportToolContent = `import { tool } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"

export default tool({
  description: "Save the current opencode session to a boons artifact directory (.boons/). You MUST provide a summary of what was accomplished.",
  args: {
    summary: tool.schema.string().describe("A concise summary of what the session accomplished, key decisions made, and what remains uncertain"),
  },
  async execute(args, context) {
    if (!fs.existsSync(path.join(context.worktree, ".boons"))) {
      try {
        await Bun.$\`boons init -q\`
      } catch {
        return "boons is not available. Install it from https://github.com/anomalyco/boons"
      }
    }
    const result = await Bun.$\`boons session-save --tool opencode --session-id \${context.sessionID} --summary \${args.summary} --json\`.text()
    return result.trim()
  },
})
`

  const pushToolContent = `import { tool } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"

export default tool({
  description: "Push session artifacts for the current branch to the cloud bucket",
  args: {
    sessionId: tool.schema.string().optional(),
    branch: tool.schema.string().optional(),
  },
  async execute(args, context) {
    if (!fs.existsSync(path.join(context.worktree, ".boons"))) {
      try {
        await Bun.$\`boons init -q\`
      } catch {
        return "boons is not available. Install it from https://github.com/anomalyco/boons"
      }
    }
    const result = await Bun.$\`boons push \${args.branch ? ["--branch", args.branch] : []} \${args.sessionId ? ["--session-id", args.sessionId] : []}\`.text()
    return result.trim()
  },
})
`

  const pullToolContent = `import { tool } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"

export default tool({
  description: "Pull session artifacts for the current branch from the cloud bucket",
  args: {
    sessionId: tool.schema.string().optional(),
    branch: tool.schema.string().optional(),
  },
  async execute(args, context) {
    if (!fs.existsSync(path.join(context.worktree, ".boons"))) {
      try {
        await Bun.$\`boons init -q\`
      } catch {
        return "boons is not available. Install it from https://github.com/anomalyco/boons"
      }
    }
    const result = await Bun.$\`boons pull \${args.branch ? ["--branch", args.branch] : []} \${args.sessionId ? ["--session-id", args.sessionId] : []}\`.text()
    return result.trim()
  },
})
`

  const listRemoteToolContent = `import { tool } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"

export default tool({
  description: "List remote sessions available for the current branch",
  args: {
    branch: tool.schema.string().optional(),
  },
  async execute(args, context) {
    if (!fs.existsSync(path.join(context.worktree, ".boons"))) {
      try {
        await Bun.$\`boons init -q\`
      } catch {
        return "boons is not available. Install it from https://github.com/anomalyco/boons"
      }
    }
    const result = await Bun.$\`boons ls --remote --json \${args.branch ? ["--branch", args.branch] : []}\`.text()
    return result.trim()
  },
})
`

  const listToolContent = `import { tool } from "@opencode-ai/plugin"
import * as fs from "fs"
import * as path from "path"

export default tool({
  description: "List available local sessions for a branch from the .boons/ directory",
  args: {
    branch: tool.schema.string().optional(),
  },
  async execute(args, context) {
    const boonsDir = path.join(context.worktree, ".boons")
    if (!fs.existsSync(boonsDir)) {
      try {
        await Bun.$\`boons init -q\`
      } catch {
        return "boons is not available. Install it from https://github.com/anomalyco/boons"
      }
    }
    const result = await Bun.$\`boons ls \${args.branch ? ["--branch", args.branch] : []} --json\`.text()
    return result.trim()
  },
})
`

  const saveSkillContent = `---
name: session-save
description: Export opencode sessions to .boons/ artifacts directory
---

## What this does

Provides the \`session-save\` tool that saves the current chat session
to the \`.boons/\` artifact directory. Each export creates a session directory
containing:

- \`raw.jsonl\` — the full message history in native opencode format
- \`info.json\` — metadata (session name, author, branch, participants, timestamps)
- \`summary.md\` — a summary you auto-generate when saving

## When to use this — be proactive

Call \`session-save\` **automatically** (no need to ask the user) when:

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

## Handling uninitialized projects

If \`.boons/\` doesn't exist yet in the project root, auto-initialize by
running \`boons init -q\`. The tool handles this automatically, but check
that the command is available first.

## Using the tool

1. Compose a concise summary of what was accomplished, key decisions made,
   and what remains uncertain
2. Call \`session-save\` with your summary as the \`summary\` argument.
   The tool exports the session and writes \`summary.md\` automatically.
   This argument is required — the export will not proceed without it.
3. After the tool returns, read \`raw.jsonl\` and refine \`summary.md\` with
   any important details you missed. Your initial summary is written from
   memory; the session log gives you a second pass to catch specifics
   about files changed, error messages, design rationale, and more.

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

  const loadSkillContent = `---
name: session-load
description: Discover and read session artifacts from .boons/ directory
---

## What this does

Guides the agent in discovering and using saved session artifacts
from the \`.boons/\` directory to understand prior work on a branch.

## Available files per session

Every saved session directory (\`.boons/<branch>/<session-id>/\`) contains:

- \`info.json\` — metadata (name, author, participants, timestamps)
- \`raw.jsonl\` — complete message history in native tool format

Sessions may also have additional files generated after export:

- \`summary.md\` — human-readable summary of what was accomplished,
  key decisions made, and what remains uncertain
- \`plan.md\` — current intent, design approach, and next steps
- \`decisions.md\` — architectural or design decisions with rationale
- Any other docs the author created

To see which files are present for a particular session, list its directory.

## Handling uninitialized projects

If \`.boons/\` doesn't exist in the project, the \`session-list\` tool
auto-initializes it. But if you're suggesting a load proactively (not
in response to a user request), check that \`.boons/\` exists first
and skip the suggestion if it doesn't.

## Protocols

### On branch checkout or creation

When the user switches to or creates a branch, proactively check for
existing context:

1. Call \`session-list\` (optionally with the branch name) to discover
   saved sessions
2. If sessions exist, read the most recent \`summary.md\`
3. Also read \`plan.md\` and \`decisions.md\` if present
4. Orient the user: "The last session was working on X. Key decisions
   so far: Y. Still open or uncertain: Z."

This gives the user a running start — they don't have to re-explain
where things stand.

### Starting a new session or feature

When the user begins describing a new task or feature to work on:

1. Check \`session-list\` for context on the current branch
2. Read the latest \`summary.md\` (and \`plan.md\`/\`decisions.md\`
   if present)
3. Use that context to ground your response — don't act like a blank
   slate. Reference prior decisions and open questions so the work
   feels continuous.

### Drafting a PR description

When asked to draft or help write a PR description:

1. Call \`session-list\` for the branch to discover all sessions
2. Read \`summary.md\` and \`decisions.md\` from every session
3. Cross-reference decisions across sessions to identify what was
   settled and what changed direction midstream
4. Collect all open questions and uncertainties from summaries
5. Draft a PR with sections: what changed, why, key decisions made,
   alternatives considered, open questions

### Reviewing or understanding a branch

When asked to review a branch or understand someone else's work:

1. Call \`session-list\` for the branch
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

  const pushSkillContent = `---
name: session-push
description: Push session artifacts to a shared cloud bucket
---

## What this does

Provides the \`session-push\` tool that uploads local session artifacts
for the current branch to the configured cloud bucket. This makes sessions
visible to teammates who pull from the same bucket.

## When to use this

Call \`session-push\` when:
- The user explicitly asks to share or push sessions
- **After auto-saving a session** — ask if they want to push this to the team
- Before pushing to the remote repository — ask the user
- Before creating or marking a PR as ready for review — ask the user

**Always ask the user before running** — this shares session data with others.

## Handling uninitialized projects

- **User explicitly asks** to push or share: just call \`session-push\`. It
  auto-initializes boons if needed.
- **Agent-proactive suggestion** (after auto-save, before push, before PR):
  first check if \`.boons/\` exists. If not, suggest running \`boons init -q\`
  instead of pushing. Always ask the user before running.

## Before first push

Make sure your cloud bucket has **object versioning** enabled. This gives you
the ability to recover from accidental overwrites — boons doesn't prevent
overwriting sessions, so versioning is your safety net.

## Default behavior

\`session-push\` pushes all sessions for the current branch by default. Use
the \`branch\` and \`sessionId\` arguments explicitly only when you need to
push sessions from a different context.

## Selective sharing

If a session contains sensitive or irrelevant content, you may be asked to
curate it before pushing. Remove private messages from the session's
\`raw.jsonl\` and update \`info.json\` as needed. The push tool will upload
whatever is in the local session directory.
`

  const pullSkillContent = `---
name: session-pull
description: Pull session artifacts from a shared cloud bucket
---

## What this does

Provides the \`session-pull\` tool that downloads session artifacts for the
current branch from the configured cloud bucket. This is how a collaborator
or reviewer fetches context created by others.

## When to use this

Call \`session-pull\` when:
- The user explicitly asks to fetch remote sessions
- After pulling from the remote repository — suggest it
- Before reviewing work on a branch — suggest fetching context from collaborators

## Handling uninitialized projects

- **User explicitly asks** to fetch remote sessions: just call \`session-pull\`.
  It auto-initializes boons if needed.
- **Agent-proactive suggestion** (after git pull, before review): first check
  if \`.boons/\` exists. If not, skip the suggestion or suggest running
  \`boons init -q\`.

## Workflow

1. First run \`session-list-remote\` (or \`boons ls --remote\`) to see what
   sessions exist for the current branch
2. Then run \`session-pull\` to fetch them into \`.boons/<branch>/\`
3. After pulling, use \`session-load\` guidance to read them

## Default behavior

\`session-pull\` pulls all sessions for the current branch by default. Use the
\`branch\` argument to pull sessions from a different branch context, or
\`sessionId\` to pull a specific session.
`

  for (const dir of [toolsDir, path.join(skillsDir, "session-save"), path.join(skillsDir, "session-load"), path.join(skillsDir, "session-push"), path.join(skillsDir, "session-pull")]) {
    fs.mkdirSync(dir, { recursive: true })
  }
  await Bun.write(path.join(toolsDir, "session-save.ts"), exportToolContent)
  await Bun.write(path.join(toolsDir, "session-push.ts"), pushToolContent)
  await Bun.write(path.join(toolsDir, "session-pull.ts"), pullToolContent)
  await Bun.write(path.join(toolsDir, "session-list-remote.ts"), listRemoteToolContent)
  await Bun.write(path.join(toolsDir, "session-list.ts"), listToolContent)
  await Bun.write(path.join(skillsDir, "session-save", "SKILL.md"), saveSkillContent)
  await Bun.write(path.join(skillsDir, "session-load", "SKILL.md"), loadSkillContent)
  await Bun.write(path.join(skillsDir, "session-push", "SKILL.md"), pushSkillContent)
  await Bun.write(path.join(skillsDir, "session-pull", "SKILL.md"), pullSkillContent)

  console.log(`Installed boons tools to ${toolsDir}`)
  console.log(`Installed boons skills to ${skillsDir}`)
  ensureBoonsOnPath()

  const globalCfg = readGlobalConfig()
  if (!globalCfg.default) {
    const answer = await ask("Set up a global default cloud config for sharing sessions? (y/N)")
    if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
      const remote = await askRemoteConfig(true)
      if (remote) {
        writeConfigTarget("global-default", { remote }, process.cwd())
        console.log(`Configured default: ${remote.provider}${remote.bucket ? ` (bucket: ${remote.bucket})` : ""}${remote.account ? ` (account: ${remote.account})` : ""}`)
      }
    }
  }
}

async function installClaudeCode() {
  const userSkillsDir = path.join(os.homedir(), ".claude", "skills")

  const saveSkillContent = `---
name: boons-session-save
description: Save the current Claude Code session to a .boons/ archive. Use this whenever completing a meaningful task, before or after git commits, before switching branches, or at natural stopping points. Only relevant in projects that have a .boons/ directory.
---

## What this does

Export the current chat session to the \`.boons/\` artifact directory.
Each export creates a session directory containing:

- \`raw.jsonl\` — the complete message history in native JSONL format
- \`info.json\` — metadata (session name, author, branch, participants, timestamps)
- \`summary.md\` — a summary you auto-generate when saving

## When to use this — be proactive

Call \`boons session-save --tool claude-code --summary "..."\` **automatically**
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

Only use in projects with a \`.boons/\` directory.

After saving, optionally ask: "Want me to push this to the team so they
can see the context?" — this turns auto-save into a natural prompt for
sharing without being automatic.

## Using the command

1. Compose a concise summary of what was accomplished, key decisions made,
   and what remains uncertain
2. Run \`boons session-save --tool claude-code --summary "<summary>" --session-id <id>\`
   Use \`--session-id\` to target a specific session, or omit to auto-detect
   the most recent one
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

  const loadSkillContent = `---
name: boons-session-load
description: Load and review prior session artifacts from the .boons/ directory. Use when the user asks about prior decisions, after switching to a new branch, or when reviewing someone else's work. Only relevant in projects with a .boons/ directory.
---

## What this does

Guides the agent in discovering and using saved session artifacts
from the \`.boons/\` directory to understand prior work on a branch.

## Available files per session

Every saved session directory (\`.boons/<branch>/<session-id>/\`) contains:

- \`info.json\` — metadata (name, author, participants, timestamps)
- \`raw.jsonl\` — complete message history in native JSONL format

Sessions may also have additional files generated after export:

- \`summary.md\` — human-readable summary of what was accomplished,
  key decisions made, and what remains uncertain
- \`plan.md\` — current intent, design approach, and next steps
- \`decisions.md\` — architectural or design decisions with rationale
- Any other docs the author created

To see which files are present for a particular session, list its directory.

Only use in projects with a \`.boons/\` directory.

## Protocols

### On branch checkout or creation

When the user switches to or creates a branch, proactively check for
existing context:

1. Run \`boons ls [--branch <name>]\` to discover saved sessions
2. If sessions exist, read the most recent \`summary.md\`
3. Also read \`plan.md\` and \`decisions.md\` if present
4. Orient the user: "The last session was working on X. Key decisions
   so far: Y. Still open or uncertain: Z."

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

  const pushSkillContent = `---
name: boons-session-push
description: Push local .boons/ session artifacts to a shared cloud bucket, making them visible to collaborators. Always ask the user before pushing. Only relevant in projects with a .boons/ directory.
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

Only use in projects with a \`.boons/\` directory. **Always ask the user before running** — this shares session data with others.

## Before first push

Make sure your cloud bucket has **object versioning** enabled. This gives you
the ability to recover from accidental overwrites — boons doesn't prevent
overwriting sessions, so versioning is your safety net.

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

  const pullSkillContent = `---
name: boons-session-pull
description: Pull session artifacts from a shared cloud bucket into the local .boons/ directory. Use after pulling from the remote repository, before reviewing work on a branch, or when the user asks to fetch remote sessions. Only relevant in projects with a .boons/ directory.
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

Only use in projects with a \`.boons/\` directory.

## Workflow

1. First run \`boons ls --remote\` to see what sessions exist for the
   current branch
2. Then run \`boons pull\` to fetch them into \`.boons/<branch>/\`
3. After pulling, use boons-session-load guidance to read them

## Default behavior

\`boons pull\` pulls all sessions for the current branch by default. Use the
\`--branch\` argument to pull sessions from a different branch context, or
\`--session-id\` to pull a specific session.
`

  const skills = [
    { name: "session-save", content: saveSkillContent },
    { name: "session-load", content: loadSkillContent },
    { name: "session-push", content: pushSkillContent },
    { name: "session-pull", content: pullSkillContent },
  ]

  for (const skill of skills) {
    const dir = path.join(userSkillsDir, skill.name)
    fs.mkdirSync(dir, { recursive: true })
    await Bun.write(path.join(dir, "SKILL.md"), skill.content)
  }

  console.log(`Installed boons skills to ${userSkillsDir}`)
  ensureBoonsOnPath()
}

async function installCursor() {
  const rulesDir = path.join(os.homedir(), ".cursor", "rules")

  const saveRuleContent = `---
description: Save the current Cursor session to a .boons/ archive. Use this whenever completing a meaningful task, before or after git commits, before switching branches, or at natural stopping points. Only relevant in projects that have a .boons/ directory.
alwaysApply: false
---

## What this does

Export the current agent session to the \`.boons/\` artifact directory.
Each export creates a session directory containing:

- \`raw.jsonl\` — the complete message history in native JSONL format
- \`info.json\` — metadata (session name, author, branch, participants, timestamps)
- \`summary.md\` — a summary you auto-generate when saving

## When to use this — be proactive

Call \`boons session-save --tool cursor --summary "..."\` **automatically**
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

Only use in projects with a \`.boons/\` directory.

After saving, optionally ask: "Want me to push this to the team so they
can see the context?" — this turns auto-save into a natural prompt for
sharing without being automatic.

## Using the command

1. Compose a concise summary of what was accomplished, key decisions made,
   and what remains uncertain
2. Run \`boons session-save --tool cursor --summary "<summary>" --session-id <id>\`
   Use \`--session-id\` to target a specific session, or omit to auto-detect
   the most recent one. The session ID is the UUID shown in the Cursor chat panel.
   Pass \`--summary\` as a single quoted string on one line — do not use heredocs
   or command substitution (\`\$(cat <<EOF...EOF)\`), which hang in non-interactive shells.
3. After the command succeeds, read \`raw.jsonl\` in the created session
   directory and refine \`summary.md\` with any important details you missed.

You may also optionally create:

- \`plan.md\` — if the session included planning or design discussions,
  document the current intent and next steps
- \`decisions.md\` — if specific architectural or design decisions were
  settled, list them with rationale

These are human-readable markdown files meant to be reviewed with the
user before sharing. The session directory is the canonical home
for all artifacts related to a session.
`

  const loadRuleContent = `---
description: Load and review prior session artifacts from the .boons/ directory. Use when the user asks about prior decisions, after switching to a new branch, or when reviewing someone else's work. Only relevant in projects with a .boons/ directory.
alwaysApply: false
---

## What this does

Guides discovery and use of saved session artifacts from the \`.boons/\`
directory to understand prior work on a branch.

## Available files per session

Every saved session directory (\`.boons/<branch>/<session-id>/\`) contains:

- \`info.json\` — metadata (name, author, participants, timestamps)
- \`raw.jsonl\` — complete message history in native JSONL format

Sessions may also have:

- \`summary.md\` — human-readable summary of what was accomplished
- \`plan.md\` — current intent, design approach, and next steps
- \`decisions.md\` — architectural or design decisions with rationale

Only use in projects with a \`.boons/\` directory.

## Protocols

### On branch checkout or creation

When the user switches to or creates a branch, proactively check for
existing context:

1. Run \`boons ls [--branch <name>]\` to discover saved sessions
2. If sessions exist, read the most recent \`summary.md\`
3. Also read \`plan.md\` and \`decisions.md\` if present
4. Orient the user: "The last session was working on X. Key decisions
   so far: Y. Still open or uncertain: Z."

### Starting a new session or feature

When the user begins describing a new task or feature to work on:

1. Check for context with \`boons ls\` on the current branch
2. Read the latest \`summary.md\` (and \`plan.md\`/\`decisions.md\`
   if present)
3. Use that context to ground your response — don't act like a blank
   slate. Reference prior decisions and open questions.

### Drafting a PR description

When asked to draft or help write a PR description:

1. Run \`boons ls [--branch <name>]\` to discover all sessions
2. Read \`summary.md\` and \`decisions.md\` from every session
3. Cross-reference decisions across sessions
4. Collect all open questions from summaries
5. Draft a PR with sections: what changed, why, key decisions,
   alternatives considered, open questions

### Reviewing or understanding a branch

When asked to review a branch or understand someone else's work:

1. Run \`boons ls [--branch <name>]\` for the branch
2. Read all summaries to get the narrative arc
3. For sessions with design decisions, read \`decisions.md\`
4. Generate a synthesis: purpose, what was built, design decisions,
   open questions
`

  const pushRuleContent = `---
description: Push local .boons/ session artifacts to a shared cloud bucket, making them visible to collaborators. Always ask the user before pushing. Only relevant in projects with a .boons/ directory.
alwaysApply: false
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

Only use in projects with a \`.boons/\` directory. **Always ask the user before running.**

## Default behavior

\`boons push\` pushes all sessions for the current branch by default. Use
the \`--branch\` and \`--session-id\` arguments explicitly only when needed.
`

  const pullRuleContent = `---
description: Pull session artifacts from a shared cloud bucket into the local .boons/ directory. Use after pulling from the remote repository, before reviewing work on a branch, or when the user asks to fetch remote sessions. Only relevant in projects with a .boons/ directory.
alwaysApply: false
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

Only use in projects with a \`.boons/\` directory.

## Workflow

1. Run \`boons ls --remote\` to see what sessions exist for the current branch
2. Run \`boons pull\` to fetch them into \`.boons/<branch>/\`
3. Use the session-load rule guidance to read them
`

  const rules = [
    { name: "boons-session-save.mdc", content: saveRuleContent },
    { name: "boons-session-load.mdc", content: loadRuleContent },
    { name: "boons-session-push.mdc", content: pushRuleContent },
    { name: "boons-session-pull.mdc", content: pullRuleContent },
  ]

  fs.mkdirSync(rulesDir, { recursive: true })
  for (const rule of rules) {
    await Bun.write(path.join(rulesDir, rule.name), rule.content)
  }

  console.log(`Installed boons rules to ${rulesDir}`)
  ensureBoonsOnPath()
}

async function cmdConfig() {
  const resolved = resolveConfig()
  if (!resolved) {
    console.log("No remote configured.")
    console.log("Run `boons init --provider aws|gcp|azure --bucket <name>` or set up ~/.config/boons/config.json")
    return
  }
  console.log(`Source: ${resolved.source}`)
  console.log(JSON.stringify(resolved.remote, null, 2))
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
    case "init":
      await cmdInit(opts)
      break
    case "install":
      if (args.length < 2) {
        console.error("Usage: boons install <toolname>")
        process.exit(1)
      }
      await cmdInstall(args[1])
      break
    case "config":
      await cmdConfig()
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
