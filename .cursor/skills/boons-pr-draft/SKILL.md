---
name: boons-pr-draft
description: When drafting a PR, load boons session context from the branch to ground the description in session history.
---

## What this does

Guides the agent to use boons session artifacts when drafting a PR,
so the description reflects the full narrative arc — not just the diff.

## Protocol

When the user asks you to draft a PR, create a PR, or write a PR description:

1. **Discover sessions** — run `boons ls [--branch <name>]` for the branch
   (defaults to current branch)
2. **Load context** — read `summary.md`, `plan.md`, and `decisions.md` from
   every session on the branch
3. **Cross-reference** — identify what was settled, what changed direction
   midstream, and what's still open
4. **Draft** — produce a PR description with sections: what changed, why,
   key decisions with rationale, alternatives considered, open questions
5. **Present to the user** — do not post the PR automatically. Let the user
   review and edit the draft.

## Relationship to session-load

This skill activates the "Drafting a PR description" protocol from the
boons-session-load skill. Refer to boons-session-load for the full
context-loading workflow.
