# Boons

Capture, share, and load AI coding session artifacts across your team.

## Why

When an AI agent helps write code, the conversation shaping that code disappears when the session ends. A pull request captures what was built — nothing captures why. Reviewers inherit the output without the reasoning: the alternatives considered, constraints identified, decisions made, uncertainties flagged.

Boons makes the conversation a first-class artifact that travels with the branch and is retrievable by any agent on the team. By the time a PR is marked ready, the substantive discussion is complete and captured. Reviewers arrive with full context.

## How It Works

The branch is the collaboration space. Every session on a branch is captured into `.boons/<branch>/<session-id>/`, a gitignored directory containing the raw message log (`raw.jsonl`), structured metadata (`info.json`), and a human-reviewed summary (`summary.md`). Optional `plan.md` and `decisions.md` add richer context for future readers.

The workflow stays entirely inside your agent tool:

**Author** — Work with your agent as usual. At natural stopping points (a commit, a feature completed, end of day), call `session-save`. The agent composes a summary of what was accomplished and what remains uncertain; you review and refine it. Call `session-push` when ready to share — sessions sync to a shared cloud bucket.

**Reviewer** — Pull the branch, then call `session-pull`. Your agent discovers the saved sessions, reads summaries, and queries the relevant logs. You have the full decision context before looking at a line of code.

No one leaves their tool. The CLI handles the mechanics; the agent handles judgment, discovery, and workflow.

## Quick Start

```sh
curl -fsSL https://raw.githubusercontent.com/dberenbaum/boons/main/install.sh | bash
boons install opencode
```

The install prompts you to configure cloud storage. After that, `session-save`, `session-push`, `session-pull`, and `session-list-remote` are available from inside your agent, regardless of which tool you use.

## Agent Workflow

Once boons is installed, all interaction happens through your agent.
Here are the natural-language triggers and what they do:

- **"Save this session"** — The agent calls `session-save`, writes a
  summary of what was accomplished, and creates the artifact in
  `.boons/<branch>/<session-id>/`.
- **"Push all sessions on this branch"** — The agent calls
  `session-push`, syncing local artifacts to the cloud bucket.
- **"Pull sessions for this branch"** — The agent calls `session-pull`,
  fetching artifacts from the cloud bucket.
- **"Find sessions related to the authentication refactor"** — The
  agent runs `session-list-remote`, reads summaries and logs, and
  presents the relevant context.

### Other tools

```sh
boons install claude-code    # Claude Code plugin + skills
boons install cursor         # Cursor .mdc rules
```

## Design

**Branch as collaboration space.** Work on a branch is not private until a PR. Sessions accumulate from the moment the branch is created — exploratory, design, implementation, review. The PR is the final checkpoint, not the start of review.

**Sessions as artifacts, not ephemera.** A session directory holds the complete raw record (`raw.jsonl`) alongside human-readable artifacts (`summary.md`, `plan.md`, `decisions.md`). The raw log is append-only and never modified. Summaries and plans are mutable — updated in place as understanding evolves.

**Push is deliberate.** Sharing is a conscious act, not a side effect of other workflow steps. Nothing is automatically synced.

**Cloud bucket for remote, not git.** Sessions don't bloat the repository. The bucket mirrors the local `.boons/` structure, navigable directly in any cloud storage browser.

**Provenance over convenience.** Every artifact carries tool, author, branch, and timestamps. You can always answer who shared what, when, on which branch.

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
boons init [--provider aws|gcp|azure ...]          Configure remote
boons install <toolname>                           Install tools + skills
boons config                                       Show current config
boons push [--session-id <id>] [--branch <b>]      Push sessions to cloud
boons pull [--session-id <id>] [--branch <b>]      Pull from cloud
```

## Prerequisites

- [Bun](https://bun.sh) runtime (install script handles this)
- Cloud CLI: `awscli`, `gsutil`, or `azcopy` (matching your provider)
- Cloud bucket with object versioning enabled
