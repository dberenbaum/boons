---
name: boons-task
description: >
  Project task runner. Always check `boons task --list` before running any
  project command (install, build, test, deploy, etc.). Use `boons task <name>`
  instead of running commands directly. Save discovered commands as scripts.
---

## When to load this skill

Load this skill whenever you are about to run any project-level command:
`npm install`, `bun run`, `pip install`, `make`, `cargo`, `go build`,
`docker compose`, or similar. First check if a task script exists.

## What this does

Manages per-project task scripts at `~/.config/boons/projects/<repo-key>/scripts/`.
Scripts are shell scripts that survive agent sessions — useful when usage caps
interrupt work mid-task.

## Commands

| Command | Behavior |
|---|---|
| `boons task` | Run `setup.sh` silently; log to `.logs/setup.log` |
| `boons task <name>` | Run `<name>.sh` silently; log to `.logs/<name>.log` |
| `boons task <name> --verbose` | Run with live terminal output |
| `boons task read <name>` | Print task output (excluding status header) |
| `boons task read <name> --status` | Print exit code (0 = success) |
| `boons task --list` | List available scripts with descriptions |
| `boons task --check` | Print script content without executing |
| `boons task --path` | Print scripts directory path |
| `boons task --env` | Open/create `.env` in $EDITOR |

## Protocol

1. **Before running any project command** → run `boons task --list` first
2. **If a matching script exists** → use `boons task <name>` instead
3. **If no matching script** → run the command directly, then save it as a task script
4. **After running** → check status with `boons task read <name> --status`
5. **If the command changes** → update the script

## When to create task scripts

Write a new script when you discover a repeatable project command:

- **Setup**: package install, git hooks, env file init → `setup.sh`
- **Build**: compile, bundle, typecheck → `build.sh`
- **Test**: unit tests, integration tests, linting → `test.sh`
- **Deploy**: deploy to staging/production → `deploy.sh`
- **Seed**: database migrations, test data → `seed.sh`
- **Dev**: run dev server, watch mode → `dev.sh`

Don't write scripts for one-off commands (ephemeral debugging, single
investigations). Only save commands that someone (including a future you)
would need to run again.

### Script format

    #!/bin/bash
    # One-line description shown by --list
    set -euo pipefail

    echo "Hello from my task"

- First `#` comment after optional shebang is the `--list` description
- `set -euo pipefail` is recommended to fail fast
- `.env` vars are sourced automatically before execution

## When to iterate (update)

Update an existing script when:

- Package manager changed (npm → pnpm, pip → uv, etc.)
- Build/test commands changed
- Environment variables were added or renamed
- The script failed and you fixed it

Overwrite the file in place. The `--check` flag lets you review what's
there before running.

## Inspection

After running a task, use `boons task read <name>` to see output without
re-executing. Use `boons task read <name> --status` to check success
before deciding whether to read the full log.

Logs live at `~/.config/boons/projects/<repo-key>/.logs/<name>.log` with
a `# exit: <code>` header on the first line.
