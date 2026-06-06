---
name: boons-task
description: >
  Project task runner. After discovering commands (setup, build, test, deploy),
  save them as scripts. Before running project commands, load this to check
  what's available. Update scripts when commands or env vars change.
---

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

## When to consume (run)

- After `git clone` — run `boons task` (or `boons task --list` then `boons task setup`)
- Before testing — check if `test.sh` exists with `boons task --list`
- Before deploying — run `boons task deploy`
- After a usage cap resets — run `boons task <name>` to continue where you left off

Always check availability first: `boons task --list`.

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
