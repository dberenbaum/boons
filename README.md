# Boons

Persistent memory for AI-assisted coding.

Boons ties your AI sessions to your codebase — branches, pull requests, build commands, and running services all become persistent context that survives tool switches and agent resets.

## Why

Every AI coding session starts from scratch — no memory of your branches, your build setup, or why decisions were made. Two problems follow:

1. **Context loss** — Decisions, rationale, and exploration that never make it into a commit message disappear when the session ends.
2. **Capability loss** — How to build, test, and deploy the project gets re-discovered on every agent reset. Worse after a usage cap: different agent, same blind start.

Boons solves both by treating your project's operational knowledge as a first-class artifact:

### Context

Sessions are auto-saved as you work. The immediate payoff is personal:

- **Context switching** — No more neverending sessions to maintain context. Recover from crashed sessions and switch between sessions with ease.
- **Multitasking** — Keep feature components isolated in separate discussions but maintain the ability to reference the latest across all related sessions.
- **PR descriptions** — Ask your agent to draft a PR from the session summaries on the branch. Grounded in actual work, not memory.

The team benefit is the same context, shared:

- **Reviewers arrive informed** — Pull a branch, pull the sessions. Full decision history before reading a line of code.
- **Onboarding** — New team members read how and why the codebase evolved, without chasing down the people who were there.
- **Answers survive the people** — "Why didn't we consider X?" The sessions still have the answer.

### Capability

Project commands (setup, build, test, deploy) are saved as cross-tool shell scripts. The next agent — same tool or different — runs `boons task list` and has the project's full operational knowledge. Usage caps and mid-task agent switches become frictionless: commands don't reset when the session does.

- **Cross-tool** — Shell scripts aren't tied to any AI tool. OpenCode, Claude Code, Cursor, and Codex all use the same `boons task` CLI.
- **Machine-local** — Stored in `~/.boons/tasks/<repo-key>/scripts/`, never pushed to git or cloud. Secrets stay on your machine via `.env` files.
- **Inspectable** — Output is written to disk. Check exit codes cheaply with `boons task read <name> --status`. To search output, get the log path with `boons task path --log <name>` then grep/read just what you need.
- **Worktree-aware** — When running across multiple git worktrees, `boons task` automatically injects unique ports and container names so services don't collide. See [Worktree resource coordination](#worktree-resource-coordination).

## How It Works

### Session persistence

Every session on a branch is saved into `~/.boons/sessions/<repo-key>/<branch>/<session-id>/`, keyed by your git remote origin:

- `raw.jsonl` — complete message history (append-only, never modified)
- `info.json` — metadata (tool, author, branch, timestamps)
- `summary.md` — what was accomplished and what remains uncertain

Your agent auto-saves at meaningful checkpoints: after modifying files, after a git commit, when you wrap up a task, or every ~15 messages of real work. No need to remember. Optional `plan.md` and `decisions.md` add richer context for future readers.

When you want to share, sessions sync to a shared cloud bucket. When you want to understand someone else's work, your agent pulls and reads their sessions for you.

What differentiates this from other session persistence tools is provenance —
attaching sessions to the projects and branches that shaped them, so context is organized the same
way teams already organize their work. Storage reflects how agents actually work: plain text files
at multiple levels of detail, from raw message logs to human-readable summaries with flexibility to
add other documents as needed.

### Project command scripts

Project commands live outside the repo in `~/.boons/tasks/<repo-key>/scripts/`, keyed by
your git remote origin. Each script is a shell file with a one-line description:

- `setup.sh` — default task, run with `boons task`
- `build.sh`, `test.sh`, `deploy.sh` — run with `boons task <name>`
- `.env` — per-project environment variables, sourced automatically

Your agent populates these scripts as it works using `boons task create`. When it discovers how to build the project, it creates `build.sh`. When commands change, it runs `boons task update`. The next agent — or the same agent after a usage cap reset — runs `boons task list` and has the full operational picture without re-discovery.

### Worktree resource coordination

When working across multiple git worktrees, each one needs unique ports for its services (web
server, database, etc.) and unique container names for Docker Compose — otherwise they collide.

Boons provides a lightweight port registry at `~/.boons/worktrees/<repo-key>/registry.json`.

Run `boons worktree register` to allocate ports for the current worktree. Allocations persist
and are scoped to the repo — a second worktree gets the next available ports.

Task scripts transparently receive the allocated values: every `boons task` invocation injects
`COMPOSE_PROJECT_NAME`, `BOONS_WORKTREE_PORT_{NAME}`, and optional short env vars (`PORT`,
`DB_PORT`, etc.) into the script environment. No `.env` file to manage and no manual port
tracking across worktrees.

See the CLI reference below for `boons worktree register`, `list`, `port`, `env`, and `prune`.

## Quick Start

```sh
curl -fsSL https://raw.githubusercontent.com/dberenbaum/boons/main/install.sh | bash
boons install opencode
```

That's it. Your agent will now auto-save sessions and manage project commands on this project. To enable sharing, configure cloud storage with `boons remote`.

## Agent Behavior

Once boons is installed, your agent handles the mechanics automatically:

- **Auto-save** — After modifying files, wrapping up a task, or every ~15 messages of real work, your agent saves the session with a summary. No prompt needed.
- **Push on request** — "Push my sessions" or after an auto-save, your agent asks if you want to share with the team.
- **Pull on branch switch** — When switching to a branch with saved sessions, your agent suggests loading them.
- **PR context** — When drafting or reviewing a PR, your agent loads session context to ground the description or review in the decision history.
- **Query on demand** — "What did we decide about X?" Your agent searches the session history.
- **Project commands** — When discovering build, test, or deploy commands, your agent saves them as task scripts with `boons task create`. Before running project commands, it checks `boons task list` first.
- **Worktree coordination** — When operating in a git worktree, the agent runs `boons worktree register` to allocate unique ports and `boons worktree unregister` on cleanup. Task scripts automatically receive the allocated ports in their environment.

## Team Collaboration

Sessions are scoped to branches. When you push code to a shared remote, you can push the matching sessions — they sync to a cloud bucket, not git, so the repo stays clean.

**Author** — Work as usual. Sessions accumulate automatically and project commands are saved as task scripts. Call `boons-session-push` when you want the team to see the context behind your code.

**Reviewer** — Pull the branch, then pull the sessions. Your agent reads the summaries and can answer questions about the decisions made, alternatives considered, and open questions — all before you look at a diff.

**Onboarder** — Any branch's session history is discoverable. Read the narrative that shaped the code, from start to finish.

## Install Details

```sh
boons install opencode    # OpenCode tools + skills (including boons-task)
boons install claude-code # Claude Code plugin + skills (including boons-task)
boons install cursor      # Cursor .mdc rules (including boons-task)
boons install codex       # Codex AGENTS.md + skills (including boons-task)
```

Each install command writes the agent skills and tool definitions that enable auto-save and project task scripts.

Cloud storage can be configured later with:

```sh
boons remote --provider gcp --bucket my-bucket
boons remote --provider aws --bucket my-bucket --region us-east-1
boons remote --provider azure --account myact --container mycont
```

## Design

Boons adapts version control principles to agentic workflows:

**Git for references not storage.** Sessions aren't checked into the repo but reference the branch,
keeping a connection to git while avoiding storage bloat and decoupling session sync from commits
(for example, pushing additional context or cleaning up old sessions without touching history).
Task scripts are keyed by git remote but stored machine-locally — never pushed to git or cloud.

**Scope by branches not commits.** Sessions span multiple commits and map naturally to branches
as both are scoped to features. Branches are broad enough to include the full feature arc but
specific enough to limit context to what's relevant.

**Track sessions not files.** Unlike code files which are modified in place, sessions are
append-only and may produce artifacts across multiple files (plans, summaries, etc.). The session is
the meaningful unit of work. Task scripts are the opposite — overwritten when commands change,
reflecting that operational knowledge is always current-state.

**Separate storage per concern.** Context lives in `~/.boons/sessions/`, keyed by git
remote, and is optionally pushed to cloud for sharing. Under the capability pillar,
task scripts live in `~/.boons/tasks/` and worktree port registries in
`~/.boons/worktrees/` — because how to build and run the project is independent
of any single session or tool.

## Supported Tools

| Tool | Integration | Session Source |
|------|-------------|----------------|
| Open Code | Native plugin: custom tools + skills in `~/.config/opencode/` | `opencode.db` (SQLite) |
| Claude Code | Plugin: SKILL.md files in `~/.claude/plugins/boons/` | JSONL under `~/.claude/projects/` |
| Cursor | `.mdc` rules in `~/.cursor/rules/` | Agent-transcript JSONL + SQLite metadata |
| Codex | `AGENTS.md` rules + skills in `.agents/skills` or `~/.agents/skills` | JSONL under `~/.codex/sessions/` |

All tools share the same `boons task` project scripts — shell scripts, not tool-specific.

## Configuration

Config is resolved from two sources in order, each inheriting and overriding the previous:

1. Global default (`~/.boons/config.json`)
2. Repo-keyed (`~/.boons/config.json` → `repos.<key>`)

The repo key is derived from `git remote origin`, normalized to `host/org/repo`. Remote objects are stored at `{prefix}/{repoKey}/{branch}/{sessionID}/`.

## CLI Reference

```
boons session-read --tool <name> --session-id <id>     Read session messages as text
boons session-save --tool <name> --summary <text>      Save session for current branch
  [--session-id <id>] [--file <path>...]
boons ls [--branch <name>] [--json]                    List saved sessions
boons ls --remote [--branch <name>] [--json]           List remote sessions
boons install <tool> [--project]                       Install skills for a tool
boons remote [--provider aws|gcp|azure ...]            Configure remote
boons push [--session-id <id>] [--branch <b>]          Push sessions to cloud
boons pull [--session-id <id>] [--branch <b>]          Pull from cloud
boons task [<name>] [--verbose] [-- <args>]            Run a task script (default: setup.sh)
boons task list                                        List available task scripts
boons task check                                       Print all task scripts without running
boons task path                                        Print scripts directory path
boons task path --logs                                 Print logs directory path
boons task path --log <name>                           Print log file path for a task
boons task path <name>                                 Print script file path for a task
boons task read <name> [--status]                      ⚠ Read task output (disfavored — use path+grep instead)
boons task create <name> --command "<cmd>"             Create a task script from a one-liner
boons task create <name> --file <path> [--force]       Create a task script from a file
boons task update <name> --command "<cmd>"             Update a task script (preserves description)
boons task update <name> --file <path>                 Update a task script from a file
boons task env [set KEY=VALUE ... | get <key> | list]  Manage environment variables
boons worktree register                                Allocate ports for this worktree
boons worktree unregister                              Release ports for this worktree
boons worktree list [--json]                           List all registered worktrees
boons worktree port <service>                          Show allocated port for a service
boons worktree env                                     Print worktree environment variables
boons worktree prune                                   Remove stale registry entries
```

## Prerequisites

- [Bun](https://bun.sh) runtime (install script handles this)
- Cloud CLI: `awscli`, `gsutil`, or `azcopy` (matching your provider)
- Cloud bucket (object versioning recommended for recovery from overwrites)
