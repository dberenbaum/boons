---
name: boons-task
description: >
  Project task runner. Always check `boons task list` before running any
  project command (install, build, test, deploy, etc.). Use `boons task <name>`
  instead of running commands directly. Auto-create task scripts for repeatable
  commands, extract env vars, and update scripts on failure.
---

## When to load this skill

Load this skill whenever you are about to run any project-level command:
`npm install`, `bun run`, `pip install`, `make`, `cargo`, `go build`,
`docker compose`, or similar. First check if a task script exists.

## What this does

Manages per-project task scripts at `~/.boons/tasks/<repo-key>/scripts/`.
Scripts are shell scripts that survive agent sessions — useful when usage caps
interrupt work mid-task.

## Commands

| Command | Behavior |
|---|---|
| `boons task` | Run `setup.sh` silently; log to `.logs/setup.log` |
| `boons task <name>` | Run `<name>.sh` silently; log to `.logs/<name>.log` |
| `boons task <name> --verbose` | Run with live terminal output |
| `boons task list` | List available scripts with descriptions |
| `boons task check` | Print script content without executing |
| `boons task path` | Print scripts directory path |
| `boons task read <name>` | Print task output (excluding status header) |
| `boons task read <name> --status` | Print exit code (0 = success) |
| `boons task create <name> --file <path>` | Create a task script from a file |
| `boons task create <name> --command "<cmd>"` | Create from a one-liner command |
| `boons task create <name> --file <path> --force` | Overwrite existing script |
| `boons task update <name> --command "<cmd>"` | Update script body, keep description |
| `boons task env` | Open/create `.env` in $EDITOR |
| `boons task env set KEY=VALUE [...]` | Set environment variables |
| `boons task env get <KEY>` | Print a single env var |
| `boons task env list` | List all env vars |

## Rules — you MUST follow these

### 1. Always check first

Before running any project-level command (`npm install`, `bun test`, `cargo build`, etc.):
**run `boons task list` first.** If a matching script exists, use
`boons task <name>` — do not run the raw command.

### 2. Auto-create immediately

After running a matching command from the table below, **you MUST immediately
create a task script** using `boons task create`. Do not move on without doing this.

| If you ran... | Create with... |
|---|---|
| `npm install`, `bun install`, `pip install`, `uv sync`, `poetry install`, `cargo build` (first run) | `boons task create setup --command "<cmd>"` |
| `npm run build`, `bun run build`, `cargo build`, `go build`, `make` | `boons task create build --command "<cmd>"` |
| `npm test`, `bun test`, `pytest`, `cargo test`, `go test`, `vitest` | `boons task create test --command "<cmd>"` |
| `npm run lint`, `eslint`, `ruff`, `biome lint` | `boons task create lint --command "<cmd>"` |
| `npm run dev`, `bun run dev`, `cargo watch` | `boons task create dev --command "<cmd>"` |
| `docker compose up`, `docker compose down` | `boons task create docker --command "<cmd>"` |
| Database migration/seed commands | `boons task create seed --command "<cmd>"` |
| Deployment commands | `boons task create deploy --command "<cmd>"` |

**Skip auto-create** for one-off commands: `ls`, `cat`, `cd`, `curl`,
`grep`, `find`, `echo`, `mkdir`, `touch`, `rm`, `git log`, `git diff`,
`git status`, `git add`, `gh` subcommands, or any command you wouldn't
run twice.

### 3. How to create

Write the script to a temp file, validate with `bash -n /tmp/<name>.sh`,
then register:

    boons task create <name> --file /tmp/<name>.sh

For one-liners, skip the file:

    boons task create build --command "npm run build"

### 4. Extract env vars from commands

When creating a task, examine the command for values that should be
configurable rather than hardcoded:

- **Secrets**: API keys, tokens, passwords — extract to `.env`, reference as `$VAR` in script
- **Environment-specific URLs**: database URLs, API endpoints, hosts — extract to `.env`
- **Config that varies**: ports, versions, registry URLs, feature flags — extract to `.env`

Workflow:
1. Strip `KEY=VALUE` prefixes from the command before saving the script
2. Replace hardcoded values with `$VAR` references in the script body
3. Register values with `boons task env set KEY=VALUE`

Example:
```
# Instead of saving:
npm run migrate --database-url postgres://user:pass@localhost:5432/dev

# Save the script with an env var reference:
npm run migrate --database-url $DATABASE_URL

# And set the value:
boons task env set DATABASE_URL=postgres://user:pass@localhost:5432/dev
```

### 5. Task fails → fix then update

After every `boons task <name>` run, check `boons task read <name> --status`.
If the exit code is non-zero:

1. Debug the issue
2. Find the corrected command
3. Run it directly to confirm it works
4. **Update the script** so no future agent hits the same failure:

   ```
   boons task update <name> --command "<corrected command>"
   ```

   This preserves the existing description but replaces the script body.

   If the command is complex, write the corrected version to a temp file and use
   `--file` instead:

   ```
   boons task create <name> --file /tmp/<name>.sh --force
   ```

Do not leave a broken script. Always update after fixing.

## Non-bash shells

By default, `--command` generates `#!/bin/bash` scripts. To use a different
shell (e.g., `zsh`):

1. Write the script to a temp file with `#!/usr/bin/env zsh`
2. Validate: `zsh -n /tmp/<name>.sh`
3. Register: `boons task create <name> --file /tmp/<name>.sh`

boons detects the shebang and runs the correct interpreter at execution time.

## Script format

    #!/bin/bash
    # One-line description shown by --list
    set -euo pipefail

    echo "Hello from my task"

- First `#` comment after the shebang is the `--list` description
- `set -euo pipefail` is recommended to fail fast
- `.env` vars are sourced automatically before execution

## Security

- `.env` files are written with `chmod 600` (owner read/write only)
- Prefer shell-level env vars (`$DATABASE_URL` set in your terminal or
  `.zshrc`) for truly sensitive secrets — `.env` is best for non-sensitive
  config (ports, endpoints, versions)
- `boons push` does not include task scripts or `.env` files —
  only session artifacts

## Inspection

After running a task, use `boons task read <name>` to see output without
re-executing. Use `boons task read <name> --status` to check success
before deciding whether to read the full log.

Logs live at `~/.boons/tasks/<repo-key>/.logs/<name>.log` with
a `# exit: <code>` header on the first line.
