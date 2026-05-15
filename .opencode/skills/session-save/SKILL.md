---
name: session-save
description: Export opencode sessions to .boons/ artifacts directory
---

## What this does

Provides the `export-session` tool that exports the current chat session
to the `.boons/` artifact directory. Each export creates a session directory
containing:

- `raw.jsonl` — the full message history in native opencode format
- `info.json` — metadata (session name, author, branch, participants, timestamps)

## When to use this

Call `export-session` when:
- The user asks to save or export the session
- A significant task or feature is completed
- Before switching branches or closing the session
- At natural stopping points during the conversation

## After export

After the tool returns, it provides the path to the exported session directory.
Use that path to:

1. Generate `summary.md` — review the messages and write a concise summary
   of what was accomplished, key decisions made, and what remains uncertain
2. Optionally create `plan.md` — if the session included planning or design
   discussions, document the current intent and next steps
3. Optionally create `decisions.md` — if specific architectural or design
   decisions were settled, list them with rationale

These are human-readable markdown files meant to be reviewed and edited by
the author before sharing.

The user may also ask for other documents to be written into the session
directory — create whatever they request. The session directory is the
canonical home for all artifacts related to a session.
