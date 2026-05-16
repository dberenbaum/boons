---
name: session-push
description: Push session artifacts to a shared cloud bucket
---

## What this does

Provides the `session-push` tool that uploads local session artifacts
for the current branch to the configured cloud bucket. This makes sessions
visible to teammates who pull from the same bucket.

## When to use this

Call `session-push` when:
- The user asks to share sessions with the team
- Before creating or marking a PR as ready for review
- After exporting sessions that contain important context for reviewers
- At natural synchronization points during collaboration

## Before first push

Make sure your cloud bucket has **object versioning** enabled. This gives you
the ability to recover from accidental overwrites — boons doesn't prevent
overwriting sessions, so versioning is your safety net.

## Default behavior

`session-push` pushes all sessions for the current branch by default. Use
the `branch` and `sessionId` arguments explicitly only when you need to
push sessions from a different context.

## Selective sharing

If a session contains sensitive or irrelevant content, you may be asked to
curate it before pushing. Remove private messages from the session's
`raw.jsonl` and update `info.json` as needed. The push tool will upload
whatever is in the local session directory.
