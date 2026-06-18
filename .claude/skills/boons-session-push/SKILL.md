---
name: boons-session-push
description: Ask to share after auto-save, before git push, or before PR review. Push sessions to cloud. Always ask user.
---

## What this does

Uploads local session artifacts for the current branch to the configured
cloud bucket. This makes sessions visible to teammates who pull from the
same bucket.

## When to use this

Run `boons push` when:
- The user explicitly asks to share or push sessions
- **After auto-saving a session** — ask if they want to push this to the team
- Before pushing to the remote repository — ask the user
- Before creating or marking a PR as ready for review — ask the user

**Always ask the user before running** — this shares session data with others.
## Before first push

Object versioning on your cloud bucket is **recommended** — it gives you
the ability to recover from accidental overwrites since boons doesn't
prevent overwriting sessions.

## Default behavior

`boons push` pushes all sessions for the current branch by default. Use
the `--branch` and `--session-id` arguments explicitly only when you need to
push sessions from a different context.

## Selective sharing

If a session contains sensitive or irrelevant content, you may be asked to
curate it before pushing. Remove private messages from the session's
`raw.jsonl` and update `info.json` as needed. The push command will upload
whatever is in the local session directory.
