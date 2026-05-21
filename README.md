# Boons

Capture, share, and reload AI coding session context across your team.

## Why

AI coding sessions hold the decisions, rationale, and exploration that never make it into a commit message. When the session ends, that context is gone.

Boons makes sessions persistent by default — your agent auto-saves them as you work. The immediate payoff is personal:

- **Context switching** — Switch back to a branch after a meeting or a day off. Your agent reads your last session and picks up where you left off.
- **Standup / status** — "What did I accomplish yesterday?" Your session summaries have the answer.
- **PR descriptions** — Ask your agent to draft a PR from the session summaries on the branch. Grounded in actual work, not memory.

The team benefit is the same context, shared:

- **Reviewers arrive informed** — Pull a branch, pull the sessions. Full decision history before reading a line of code.
- **Onboarding** — New team members read how and why the codebase evolved, without chasing down the people who were there.
- **Answers survive the people** — "Why didn't we consider X?" The sessions still have the answer.

## How It Works

Every session on a branch is saved into `.boons/<branch>/<session-id>/`, a gitignored directory containing:

- `raw.jsonl` — complete message history (append-only, never modified)
- `info.json` — metadata (tool, author, branch, timestamps)
- `summary.md` — what was accomplished and what remains uncertain

Your agent auto-saves at meaningful checkpoints: after modifying files, after a git commit, when you wrap up a task, or every ~15 messages of real work. No need to remember. Optional `plan.md` and `decisions.md` add richer context for future readers.

When you want to share, sessions sync to a shared cloud bucket. When you want to understand someone else's work, your agent pulls and reads their sessions for you.

## Quick Start

```sh
curl -fsSL https://raw.githubusercontent.com/dberenbaum/boons/main/install.sh | bash
boons install opencode
```

That's it. Your agent will now auto-save sessions on this project. To enable sharing, configure cloud storage with `boons remote`.

## Agent Behavior

Once boons is installed, your agent handles the mechanics automatically:

- **Auto-save** — After modifying files, wrapping up a task, or every ~15 messages of real work, your agent saves the session with a summary. No prompt needed.
- **Push on request** — "Push my sessions" or after an auto-save, your agent asks if you want to share with the team.
- **Pull on branch switch** — When switching to a branch with saved sessions, your agent suggests loading them.
- **Query on demand** — "What did we decide about X?" Your agent searches the session history.

## Team Collaboration

Sessions are scoped to branches. When you push code to a shared remote, you can push the matching sessions — they sync to a cloud bucket, not git, so the repo stays clean.

**Author** — Work as usual. Sessions accumulate automatically. Call `session-push` when you want the team to see the context behind your code.

**Reviewer** — Pull the branch, then pull the sessions. Your agent reads the summaries and can answer questions about the decisions made, alternatives considered, and open questions — all before you look at a diff.

**Onboarder** — Any branch's session history is discoverable. Read the narrative that shaped the code, from start to finish.

## Install Details

```sh
boons install opencode    # OpenCode tools + skills
boons install claude-code # Claude Code plugin + skills
boons install cursor      # Cursor .mdc rules
```

Each install command writes the agent skills and tool definitions that enable auto-save.

Cloud storage can be configured later with:

```sh
boons remote --provider gcp --bucket my-bucket
boons remote --provider aws --bucket my-bucket --region us-east-1
boons remote --provider azure --account myact --container mycont
```

## Design

**Branch as collaboration space.** Work on a branch is not private until a PR. Sessions accumulate from the moment the branch is created — exploratory, design, implementation, review. The PR is the final checkpoint, not the start of review.

**Sessions as artifacts, not ephemera.** A session directory holds the complete raw record (`raw.jsonl`) alongside human-readable artifacts (`summary.md`, `plan.md`, `decisions.md`). The raw log is append-only and never modified. Summaries and plans are mutable — updated in place as understanding evolves.

**Auto-save by default, share on request.** Sessions are saved automatically so nothing is lost. Sharing to the cloud is deliberate — nothing is synced without asking.

**Cloud bucket for remote, not git.** Sessions don't bloat the repository. The bucket mirrors the local `.boons/` structure, navigable directly in any cloud storage browser.

**Provenance over convenience.** Every artifact carries tool, author, branch, and timestamps. You can always answer who created what, when, and on which branch.

**CLI-first, agent-aware.** The CLI handles all mechanical operations (export, push, pull, list). Agents provide judgment, discovery, and workflow guidance through tool integrations and skills.

**Zero npm dependencies.** Uses Bun built-ins (`bun:sqlite`, `Glob`, `Bun.$`) and platform cloud CLIs (`aws`, `gsutil`, `azcopy`).

## Supported Tools

| Tool | Integration | Session Source |
|------|-------------|----------------|
| Open Code | Native plugin: custom tools + skills in `~/.config/opencode/` | `opencode.db` (SQLite) |
| Claude Code | Plugin: 4 SKILL.md files in `~/.claude/plugins/boons/` | JSONL under `~/.claude/projects/` |
| Cursor | `.mdc` rules in `~/.cursor/rules/` | Agent-transcript JSONL + SQLite metadata |

## Configuration

Config is resolved from three sources in order, each inheriting and overriding the previous:

1. Global default (`~/.config/boons/config.json`)
2. Repo-keyed global (`~/.config/boons/config.json` → `repos.<key>`)
3. Per-repo (`.boons/config.json`)

The repo key is derived from `git remote origin`, normalized to `host/org/repo`. Remote objects are stored at `{prefix}/{repoKey}/{branch}/{sessionID}/`.

## CLI Reference

```
boons session-save --tool <name> [--session-id <id>] [--summary <text>]
                                                  Save session to .boons/
boons ls [--branch <name>]                        List local sessions
boons ls --remote [--branch <name>]                List remote sessions
boons install <tool>                               Install skills for a tool
boons install <tool> --project                     Install skills + project .gitignore
boons remote                                       Show remote config, or prompt if none
boons remote --provider aws|gcp|azure ...           Configure remote
boons remote --project --provider aws|gcp|azure    Configure remote per-project
boons push [--session-id <id>] [--branch <b>]      Push sessions to cloud
boons pull [--session-id <id>] [--branch <b>]      Pull from cloud
```

## Prerequisites

- [Bun](https://bun.sh) runtime (install script handles this)
- Cloud CLI: `awscli`, `gsutil`, or `azcopy` (matching your provider)
- Cloud bucket (object versioning recommended for recovery from overwrites)
