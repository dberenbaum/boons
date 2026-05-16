import * as path from "path"
import * as fs from "fs"
import * as readline from "node:readline"
import { Glob } from "bun"
import { exportSession } from "./export"
import {
  readConfig,
  writeConfig,
  push,
  pull,
  listRemote,
} from "./cloud"

let pipedAnswers: string[] | null = null

if (!process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin })
  const lines: string[] = []
  for await (const line of rl) {
    lines.push(line.trim())
  }
  rl.close()
  pipedAnswers = lines
}

function ask(query: string): Promise<string> {
  if (pipedAnswers) {
    const answer = pipedAnswers.shift() ?? ""
    console.log(`${query} ${answer}`)
    return Promise.resolve(answer)
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(query + " ", answer => { rl.close(); resolve(answer.trim()) })
  })
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
  boons export [--session-id <id>] [--json]     Export session to .boons/
  boons ls [--branch <name>] [--json]            List saved sessions
  boons ls --remote [--branch <name>] [--json]   List remote sessions
  boons init [<provider-flags>]                  Install tools + skills + config
  boons config                                   Show current config
  boons push [--session-id <id>] [--branch <b>]  Push sessions to cloud
  boons pull [--session-id <id>] [--branch <b>]  Pull sessions from cloud
  boons --help                                   Show this message

Provider flags (for init):
  --provider aws|gcp|azure  Cloud provider
  --bucket <name>           Bucket name (aws/gcp)
  --region <name>           AWS region
  --account <name>          Azure storage account
  --container <name>        Azure container
  --prefix <path>           Optional key prefix in bucket

Options:
  --session-id <id>   Session to export/push/pull (default: auto-detect / all)
  --branch <name>     Filter by branch (default: current branch)
  --json              Output as JSON (for tool integration)

Environment:
  BOONS_DB_PATH       OpenCode database path (default: ~/.local/share/opencode/opencode.db)
`

async function cmdExport(args: Record<string, string>) {
  const sessionID = args["--session-id"]
  const asJson = args["--json"] === "true"

  const result = await exportSession({ sessionID })

  if (asJson) {
    console.log(JSON.stringify(result))
  } else {
    console.log(`Exported ${result.messageCount} messages to ${result.dir}`)
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
  const toolsDir = path.join(cwd, ".opencode", "tools")
  const skillsDir = path.join(cwd, ".opencode", "skills")
  const gitignorePath = path.join(cwd, ".gitignore")

  const exportToolContent = `import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Export the current opencode session to a boons artifact directory (.boons/)",
  args: {},
  async execute(_args, context) {
    const result = await Bun.$\`boons export --session-id \${context.sessionID} --json\`.text()
    const parsed = JSON.parse(result.trim())
    return \`Exported \${parsed.messageCount} messages to \${parsed.dir}\`
  },
})
`

  const pushToolContent = `import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Push session artifacts for the current branch to the cloud bucket",
  args: {
    sessionId: tool.schema.string().optional(),
    branch: tool.schema.string().optional(),
  },
  async execute(args) {
    const result = await Bun.$\`boons push \${args.branch ? ["--branch", args.branch] : []} \${args.sessionId ? ["--session-id", args.sessionId] : []}\`.text()
    return result.trim()
  },
})
`

  const pullToolContent = `import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Pull session artifacts for the current branch from the cloud bucket",
  args: {
    sessionId: tool.schema.string().optional(),
    branch: tool.schema.string().optional(),
  },
  async execute(args) {
    const result = await Bun.$\`boons pull \${args.branch ? ["--branch", args.branch] : []} \${args.sessionId ? ["--session-id", args.sessionId] : []}\`.text()
    return result.trim()
  },
})
`

  const listRemoteToolContent = `import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "List remote sessions available for the current branch",
  args: {
    branch: tool.schema.string().optional(),
  },
  async execute(args) {
    const result = await Bun.$\`boons ls --remote --json \${args.branch ? ["--branch", args.branch] : []}\`.text()
    return result.trim()
  },
})
`

  const saveSkillContent = `---
name: session-save
description: Export opencode sessions to .boons/ artifacts directory
---

## What this does

Provides the \`export-session\` tool that exports the current chat session
to the \`.boons/\` artifact directory. Each export creates a session directory
containing:

- \`raw.jsonl\` — the full message history in native opencode format
- \`info.json\` — metadata (session name, author, branch, participants, timestamps)

## When to use this

Call \`export-session\` when:
- The user asks to save or export the session
- A significant task or feature is completed
- Before switching branches or closing the session
- At natural stopping points during the conversation

## After export

After the tool returns, it provides the path to the exported session directory.
Use that path to:

1. Generate \`summary.md\` — review the messages and write a concise summary
   of what was accomplished, key decisions made, and what remains uncertain
2. Optionally create \`plan.md\` — if the session included planning or design
   discussions, document the current intent and next steps
3. Optionally create \`decisions.md\` — if specific architectural or design
   decisions were settled, list them with rationale

These are human-readable markdown files meant to be reviewed and edited by
the author before sharing.

The user may also ask for other documents to be written into the session
directory — create whatever they request. The session directory is the
canonical home for all artifacts related to a session.
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

## When to use this

Use \`boons ls\` when:
- Starting work on a branch that may have saved sessions
- The user asks about decisions made in prior sessions
- Reviewing someone else's work and need context
- Wondering whether a question was already discussed

## Discovery workflow

1. Run \`boons ls [--branch <name>]\` to see what sessions exist.
   This shows session names, message counts, and which extra files
   (summary, plan, decisions, etc.) are available.
2. For sessions that look relevant, read \`summary.md\` first for
   a concise overview and key decisions.
3. If more detail is needed, read \`raw.jsonl\` — each line is a JSON
   object with \`{info, parts}\` reflecting the chat message.
   Search it with grep or process it line by line.
4. Check for any other docs present in the session directory
   (\`plan.md\`, \`decisions.md\`, etc.).
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
- The user asks to share sessions with the team
- Before creating or marking a PR as ready for review
- After exporting sessions that contain important context for reviewers
- At natural synchronization points during collaboration

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
- Starting work on a branch that may have shared sessions
- Before reviewing work on a branch — this gives context from the author
- The user asks to see what sessions are available

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

  await Bun.$`mkdir -p ${toolsDir} ${path.join(skillsDir, "session-save")} ${path.join(skillsDir, "session-load")} ${path.join(skillsDir, "session-push")} ${path.join(skillsDir, "session-pull")}`
  await Bun.write(path.join(toolsDir, "export-session.ts"), exportToolContent)
  await Bun.write(path.join(toolsDir, "session-push.ts"), pushToolContent)
  await Bun.write(path.join(toolsDir, "session-pull.ts"), pullToolContent)
  await Bun.write(path.join(toolsDir, "session-list-remote.ts"), listRemoteToolContent)
  await Bun.write(path.join(skillsDir, "session-save", "SKILL.md"), saveSkillContent)
  await Bun.write(path.join(skillsDir, "session-load", "SKILL.md"), loadSkillContent)
  await Bun.write(path.join(skillsDir, "session-push", "SKILL.md"), pushSkillContent)
  await Bun.write(path.join(skillsDir, "session-pull", "SKILL.md"), pullSkillContent)

  await configureCloud(cwd, args)

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

  console.log(`Installed tools to ${toolsDir}`)
  console.log(`Installed skills to ${skillsDir}`)
}

async function configureCloud(cwd: string, args: Record<string, string>) {
  const providerFlag = args["--provider"]
  const hasFlags = providerFlag || args["--bucket"] || args["--account"] || args["--container"]

  if (hasFlags) {
    const remote: Record<string, string> = { provider: providerFlag || "" }
    if (args["--bucket"]) remote.bucket = args["--bucket"]
    if (args["--region"]) remote.region = args["--region"]
    if (args["--account"]) remote.account = args["--account"]
    if (args["--container"]) remote.container = args["--container"]
    if (args["--prefix"]) remote.prefix = args["--prefix"]
    writeConfig({ remote: remote as any }, cwd)
    console.log(`Configured remote: ${providerFlag}${remote.bucket ? ` (bucket: ${remote.bucket})` : ""}${remote.account ? ` (account: ${remote.account})` : ""}`)
    return
  }

  const answer = await ask("Configure cloud remote for sharing sessions? (y/N)")
  if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") return

  const provider = await ask("Cloud provider (aws/gcp/azure):")
  const valid = ["aws", "gcp", "azure"]
  if (!valid.includes(provider)) {
    console.log(`Skipping: unsupported provider "${provider}". Use aws, gcp, or azure.`)
    return
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

  writeConfig({ remote: remote as any }, cwd)
  console.log(`Configured remote: ${provider}${remote.bucket ? ` (bucket: ${remote.bucket})` : ""}${remote.account ? ` (account: ${remote.account})` : ""}`)
}

async function cmdConfig() {
  const config = readConfig()
  if (!config.remote) {
    console.log("No remote configured.")
    console.log("Run `boons init --provider aws|gcp|azure --bucket <name>` to set one up.")
    return
  }
  console.log(JSON.stringify(config, null, 2))
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
    case "export":
      await cmdExport(opts)
      break
    case "ls":
      await cmdLs(opts)
      break
    case "init":
      await cmdInit(opts)
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
