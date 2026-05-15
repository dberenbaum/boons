import * as path from "path"
import * as fs from "fs"
import { Glob } from "bun"
import { exportSession } from "./export"

const HELP = `boons — collaborative session artifact tool

Usage:
  boons export [--session-id <id>] [--json]   Export session to .boons/
  boons ls [--branch <name>] [--json]          List saved sessions in .boons/
  boons init                                    Install tools + skills
  boons --help                                  Show this message

Options:
  --session-id <id>   Session to export (default: auto-detect)
  --branch <name>     Filter by branch
  --json              Output as JSON (for tool integration)
  --directory <path>  Project directory (default: current directory)

Environment:
  BOONS_DB_PATH       OpenCode database path (default: ~/.local/share/opencode/opencode.db)
`

async function cmdExport(args: Record<string, string>) {
  const sessionID = args["--session-id"]
  const asJson = args["--json"] === "true"
  const directory = args["--directory"]

  const result = await exportSession({ sessionID, directory })

  if (asJson) {
    console.log(JSON.stringify(result))
  } else {
    console.log(`Exported ${result.messageCount} messages to ${result.dir}`)
  }
}

async function cmdLs(args: Record<string, string>) {
  const cwd = process.cwd()
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

async function cmdInit() {
  const cwd = process.cwd()
  const toolsDir = path.join(cwd, ".opencode", "tools")
  const skillsDir = path.join(cwd, ".opencode", "skills")
  const gitignorePath = path.join(cwd, ".gitignore")

  const toolContent = `import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Export the current opencode session to a boons artifact directory (.boons/)",
  args: {},
  async execute(_args, context) {
    const result = await Bun.$\`boons export --session-id \${context.sessionID} --directory \${context.directory} --json\`.text()
    const parsed = JSON.parse(result.trim())
    return \`Exported \${parsed.messageCount} messages to \${parsed.dir}\`
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

  await Bun.$`mkdir -p ${toolsDir} ${path.join(skillsDir, "session-save")} ${path.join(skillsDir, "session-load")}`
  await Bun.write(path.join(toolsDir, "export-session.ts"), toolContent)
  await Bun.write(path.join(skillsDir, "session-save", "SKILL.md"), saveSkillContent)
  await Bun.write(path.join(skillsDir, "session-load", "SKILL.md"), loadSkillContent)

  try {
    const existing = await Bun.file(gitignorePath).text()
    if (!existing.split("\n").some((l) => l.trim() === ".boons/")) {
      await Bun.write(gitignorePath, existing + "\n.boons/\n")
      console.log("Appended .boons/ to .gitignore")
    }
  } catch {
    await Bun.write(gitignorePath, ".boons/\n")
    console.log("Created .gitignore with .boons/")
  }

  console.log(`Installed export-session tool to ${toolsDir}`)
  console.log(`Installed session-save skill to ${path.join(skillsDir, "session-save")}`)
  console.log(`Installed session-load skill to ${path.join(skillsDir, "session-load")}`)
}

async function main() {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(HELP)
    return
  }

  const cmd = args[0]

  if (cmd === "export") {
    const opts: Record<string, string> = {}
    for (let i = 1; i < args.length; i++) {
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
    await cmdExport(opts)
  } else if (cmd === "ls") {
    const opts: Record<string, string> = {}
    for (let i = 1; i < args.length; i++) {
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
    await cmdLs(opts)
  } else if (cmd === "init") {
    await cmdInit()
  } else {
    console.error(`Unknown command: ${cmd}`)
    console.log(HELP)
    process.exit(1)
  }
}

main()
