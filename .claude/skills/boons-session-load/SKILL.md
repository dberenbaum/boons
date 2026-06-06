---
name: boons-session-load
description: Load prior context on branch switch, before new features, or when drafting PRs. Read .boons/ session summaries.
---

## What this does

Guides the agent in discovering and using saved session artifacts
from the `.boons/` directory to understand prior work on a branch.

## Available files per session

Every saved session directory (`.boons/<branch>/<session-id>/`) contains:

- `info.json` — metadata (name, author, participants, timestamps)
- `raw.jsonl` — complete message history in native format

Sessions may also have additional files generated after export:

- `summary.md` — human-readable summary of what was accomplished,
  key decisions made, and what remains uncertain
- `plan.md` — current intent, design approach, and next steps
- `decisions.md` — architectural or design decisions with rationale
- Any other docs the author created

To see which files are present for a particular session, list its directory.

## Protocols

### On branch checkout or creation

When the user switches to or creates a branch, proactively check for
existing context:

1. Run `boons ls [--branch <name>]` to discover saved sessions
2. Read `summary.md` from **every session** on the branch to
   understand the full narrative arc — skim all summaries, then
   decide which sessions need a deeper look via `raw.jsonl`
3. Also read `plan.md` and `decisions.md` if present
4. Orient the user: "Sessions on this branch worked on X, Y, Z.
   Key decisions so far: A. Still open or uncertain: B."
5. If the new branch has no sessions, check for sessions on the branch
   you came from or on `main`/`master`. Run `boons ls --branch <name>`
   to discover relevant context.

This gives the user a running start — they don't have to re-explain
where things stand.

### Starting a new session or feature

When the user begins describing a new task or feature to work on:

1. Run `boons ls` to see all sessions on the current branch
2. Read `summary.md` from every session — don't assume the most
   recent session covers it. Skim all summaries to find context
   relevant to the new task.
3. Use that context to ground your response — don't act like a blank
   slate. Reference prior decisions and open questions so the work
   feels continuous.

### Drafting a PR description

When asked to draft or help write a PR description:

1. Run `boons ls [--branch <name>]` to discover all sessions
2. Read `summary.md` and `decisions.md` from every session
3. Cross-reference decisions across sessions to identify what was
   settled and what changed direction midstream
4. Collect all open questions and uncertainties from summaries
5. Draft a PR with sections: what changed, why, key decisions made,
   alternatives considered, open questions

### Reviewing or understanding a branch

When asked to review a branch or understand someone else's work:

1. Run `boons ls [--branch <name>]` for the branch
2. Read all summaries to get the narrative arc of the branch — how
   the code evolved across sessions, not just the final state
3. For sessions that mention specific design decisions, read
   `decisions.md`
4. Generate a synthesis: overall purpose, what was built, design
   decisions with rationale, open questions

### Finding specific context

When the user asks about a specific feature, bug, or decision:

1. Run `boons ls` on the current branch
2. Skim `summary.md` from all sessions — look for keywords
   matching the topic
3. If no match found, search other branches with
   `boons ls --branch <name>` and skim their summaries
4. For promising sessions, read `raw.jsonl` for full detail

If `summary.md` files are sparse and `raw.jsonl` exists, you may
read the raw logs directly to fill in gaps — but prefer summaries
as the starting point.
