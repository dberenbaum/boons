---
name: boons-pr-review
description: When reviewing a PR or branch, load boons context to understand the intent behind changes.
---

## What this does

Guides the agent to load boons session context before reviewing code,
so the review evaluates intent vs. execution — not just line-level
correctness.

## Protocol

When the user asks you to review a PR, review a branch, or understand
someone else's work:

1. **Fetch context** — if the branch has remote sessions, suggest
   `boons pull` to fetch them first
2. **Discover sessions** — run `boons ls [--branch <name>]` for the branch
3. **Load context** — read `summary.md`, `plan.md`, and `decisions.md` from
   every session
4. **Synthesize** — understand the overall purpose, what was built, design
   rationale, and open questions
5. **Review the diff** — examine the actual code changes with that context.
   Flag places where the implementation diverges from the plan or where
   intent is unclear
6. **Present the review to the user** — do not post it automatically via
   `gh pr review`. Let the user decide when and how to share.

## Relationship to session-load

This skill activates the "Reviewing or understanding a branch" protocol
from the boons-session-load skill. Refer to boons-session-load for the full
context-loading workflow.
