import * as path from "path"
import { exportSession } from "./export"
import { getDefaultDBPath, discoverSessions } from "./opencode"

const HELP = `boons — collaborative session artifact tool

Usage:
  boons export [--session-id <id>] [--json]   Export session to .boons/
  boons list                                    List sessions for current project
  boons init                                    Install tool + skill into current project
  boons --help                                  Show this message

Options:
  --session-id <id>   Session to export (default: auto-detect from current directory)
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

async function cmdList() {
  const cwd = process.cwd()
  const dbPath = getDefaultDBPath()
  const sessions = discoverSessions(dbPath, cwd)

  if (sessions.length === 0) {
    console.log("No sessions found for this directory.")
    return
  }

  for (const s of sessions) {
    const created = new Date(s.time.created).toISOString()
    const updated = new Date(s.time.updated).toISOString()
    console.log(`${s.id}\t${s.title}\t${created}\t${updated}`)
  }
}

async function cmdInit() {
  const cwd = process.cwd()
  const toolsDir = path.join(cwd, ".opencode", "tools")
  const skillsDir = path.join(cwd, ".opencode", "skills", "session-save")
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

  const skillContent = `---
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
`

  await Bun.$`mkdir -p ${toolsDir} ${skillsDir}`
  await Bun.write(path.join(toolsDir, "export-session.ts"), toolContent)
  await Bun.write(path.join(skillsDir, "SKILL.md"), skillContent)

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
  console.log(`Installed session-save skill to ${skillsDir}`)
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
  } else if (cmd === "list") {
    await cmdList()
  } else if (cmd === "init") {
    await cmdInit()
  } else {
    console.error(`Unknown command: ${cmd}`)
    console.log(HELP)
    process.exit(1)
  }
}

main()
