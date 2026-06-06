---
name: boons-session-save
description: "Auto-save at natural stopping points: before commits, before branch switches, every ~15 messages, or when user is satisfied. Do NOT ask."
---

## What this does

Export the current chat session to the `.boons/` artifact directory.
Each export creates a session directory containing:

- `raw.jsonl` — the complete message history in native format
- `info.json` — metadata (session name, author, branch, participants, timestamps)
- `summary.md` — a summary you auto-generate when saving
- Any other files you include via `--file` (plan.md, decisions.md, etc.)

## When to use this — be proactive

Run `boons session-save --tool cursor --summary "..."` **automatically**
(no need to ask the user) when:

- **You modified files** — after writing code that changes multiple files,
  add a commit, or fix a bug. You know work happened; save it.
- **The user expresses satisfaction** — "that works", "looks good", "great",
  "thanks". Treat this as a close signal worth capturing.
- **Every ~15 messages** of activity involving file changes — save a checkpoint
  so the session history is never more than a few exchanges behind.
- **A git commit is made** — if you were involved in the commit, save first
  so the session matches the commit.
- **Before creating a branch** — save before running `git checkout -b` or
  `git branch` to capture the exploration that led to it.
- **The user explicitly asks** — always.

Do NOT auto-save on trivial exchanges (single-line suggestions, yes/no
answers, README-only typos). Use judgment.

After saving, optionally ask: "Want me to push this to the team so they
can see the context?" — this turns auto-save into a natural prompt for
sharing without being automatic.

## Branch awareness

Before saving, check the current branch with `git rev-parse --abbrev-ref HEAD`:

- If on `main`, `master`, or `HEAD` (detached), flag it to the user.
  Sessions on default branches can get mixed in with stable history.
  Suggest creating a feature branch: `git checkout -b <branch-name>`.
  Don't block — let the user decide (hotfixes, docs, etc. happen on main).
- When starting a new task, suggest branching first if the user is on `main`.
- When the user is about to switch branches, save the current session first
  so context is captured on the right branch.
## Using the command

1. Run `boons session-read --tool cursor` to review the conversation
   before writing anything — the session ID can be discovered from
   `boons ls` or provided by the user.
2. Based on your review, compose a thorough summary and any additional
   docs (plan.md, decisions.md, etc.) — write them as local files, or
   reference existing files the user has already authored.

   Keep your summary **concise** — it's the primary way sessions are
   discovered later. Focus on: what was accomplished, key decisions,
   files changed, and what's still open or uncertain. Future agents
   read this summary first to decide if the full session is relevant.
3. Run `boons session-save --tool cursor --summary "<summary>" \
      --file /path/to/summary.md [--file /path/to/plan.md]`
   Use `--file` for each authored file to copy into the session directory
   alongside the auto-generated export (raw.jsonl, info.json, summary.md from --summary).

The `--session-id` flag is optional — when omitted, boons automatically
detects the most recent session for the current project. Pass `--session-id`
explicitly to target a different session.

You may also optionally create:

- `plan.md` — if the session included planning or design discussions,
  document the current intent and next steps
- `decisions.md` — if specific architectural or design decisions were
  settled, list them with rationale
- Any other docs the user asks for or that you think would be useful
  to someone loading this session later

These are human-readable markdown files meant to be reviewed with the
user before sharing. The session directory is the canonical home
for all artifacts related to a session.
