---
name: session-load
description: Discover and read session artifacts from .boons/ directory
---

## What this does

Guides the agent in discovering and using saved session artifacts
from the `.boons/` directory to understand prior work on a branch.

## Available files per session

Every saved session directory (`.boons/<branch>/<session-id>/`) contains:

- `info.json` — metadata (name, author, participants, timestamps)
- `raw.jsonl` — complete message history in native tool format

Sessions may also have additional files generated after export:

- `summary.md` — human-readable summary of what was accomplished,
  key decisions made, and what remains uncertain
- `plan.md` — current intent, design approach, and next steps
- `decisions.md` — architectural or design decisions with rationale
- Any other docs the author created

To see which files are present for a particular session, list its directory.

## When to use this

Use `boons ls` when:
- Starting work on a branch that may have saved sessions
- The user asks about decisions made in prior sessions
- Reviewing someone else's work and need context
- Wondering whether a question was already discussed

## Discovery workflow

1. Run `boons ls [--branch <name>]` to see what sessions exist.
   This shows session names, message counts, and which extra files
   (summary, plan, decisions, etc.) are available.
2. For sessions that look relevant, read `summary.md` first for
   a concise overview and key decisions.
3. If more detail is needed, read `raw.jsonl` — each line is a JSON
   object with `{info, parts}` reflecting the chat message.
   Search it with grep or process it line by line.
4. Check for any other docs present in the session directory
   (`plan.md`, `decisions.md`, etc.).
