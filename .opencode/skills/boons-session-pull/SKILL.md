---
name: boons-session-pull
description: Fetch remote context after git pull or before code review. Pull .boons/ from cloud.
---

## What this does

Downloads session artifacts for the current branch from the configured
cloud bucket. This is how a collaborator or reviewer fetches context
created by others.

## When to use this

Run `boons pull` when:
- The user explicitly asks to fetch remote sessions
- After pulling from the remote repository — suggest it
- Before reviewing work on a branch — suggest fetching context from collaborators

## Workflow

1. First run `boons ls --remote` to see what sessions exist for the
   current branch
2. Then run `boons pull` to fetch them into `.boons/<branch>/`
3. After pulling, use the session-load guidance to read them

## Default behavior

`boons pull` pulls all sessions for the current branch by default. Use the
`--branch` argument to pull sessions from a different branch context, or
  `--session-id` to pull a specific session.
