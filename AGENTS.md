<!-- boons -->
# boons

Save sessions after making plans, before switching branches, or every ~15 tool calls.
Use `boons session-save --summary "..."`.

Before running any project command (install, build, test, deploy, etc.),
load the boons-task skill and run `boons task list` to check for an
existing script. Use `boons task <name>` instead, or auto-create one with
`boons task create <name> --command "<cmd>"` after running the command.

Also available: boons-session-load (prior context), boons-session-push (share
to cloud), boons-session-pull (fetch from cloud), boons-task (project task
runner), boons-worktree (worktree port coordination).

Context may span repos: `boons plan --all-repos` and `boons ls --all-repos`
search every repo stored on this machine, and `--repo <key|url>` targets one.
Use boons to save plans and find plans, in any repo.
<!-- /boons -->







