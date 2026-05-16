---
name: session-pull
description: Pull session artifacts from a shared cloud bucket
---

## What this does

Provides the `session-pull` tool that downloads session artifacts for the
current branch from the configured cloud bucket. This is how a collaborator
or reviewer fetches context created by others.

## When to use this

Call `session-pull` when:
- Starting work on a branch that may have shared sessions
- Before reviewing work on a branch — this gives context from the author
- The user asks to see what sessions are available

## Workflow

1. First run `session-list-remote` (or `boons ls --remote`) to see what
   sessions exist for the current branch
2. Then run `session-pull` to fetch them into `.boons/<branch>/`
3. After pulling, use `session-load` guidance to read them

## Default behavior

`session-pull` pulls all sessions for the current branch by default. Use the
`branch` argument to pull sessions from a different branch context, or
`sessionId` to pull a specific session.
