# Collaborative Agentic Coding: A Proposal

## The Problem

When an AI agent helps a developer write code today, the conversation that shaped that code disappears the moment the session ends. The pull request captures what was built; nothing captures why. Reviewers inherit the output without the reasoning — the alternatives considered, the constraints identified, the uncertainties flagged, the decisions made. This is not a new problem. It is the oldest problem in software collaboration. But agentic coding makes it sharper, because more of the consequential thinking is now happening in a medium that currently leaves no trace.

At the same time, the pull request workflow itself has a structural flaw: work happens privately, then gets thrown over the wall for review. Review becomes a discovery process rather than a ratification of decisions already understood. This compounds the loss of context — not only is the reasoning gone, but the reviewer was absent while it was happening.

This proposal sketches an architecture that addresses both problems, using conventions and tools that largely already exist.

---

## Prior Art

The problem this proposal addresses is actively felt and being worked on. Several efforts are already underway, each solving a part of it. Understanding where they fall short motivates the fuller design described here.

**GitHub issue #10368 — Chat Package Export/Import.** A feature request on the Claude Code repository proposing git-compatible JSONL export of conversations, tied to the repository, resumable by teammates, with selective redaction of sensitive content. It even proposes a `.roundtable/chats/` directory structure. This is essentially the foundational layer of this proposal framed as a Claude Code feature request, and validates that the need is recognized within the Claude Code community itself. It remains unimplemented.

**session-bridge** (Shreyas Patil). A Claude Code plugin that enables two live agent sessions on the same machine to exchange messages in real time through a file-based inbox/outbox system. The key architectural insight the author arrived at — rather than approximating an agent's context from outside, have the agent itself enter a listening loop and respond from its actual live context — is directly relevant to multi-agent collaboration. The primary limitation is that it is single-machine only; two developers on different machines cannot use it. It also addresses live coordination between sessions rather than the persistent, asynchronous, branch-scoped artifact model described here.

**Will Larson's internal transcript sharing.** An engineering leader describes building an internal repository of Claude Code sessions using Simon Willison's `claude-code-transcripts` extraction tool, a shared git repository as the store, a simple CLI command to push sessions, and Cloudflare Pages with SSO as the viewer. Built in an hour or two, it validates the lightweight approach and the value of making sessions visible across a team. The framing is instructive: internal adoption of agentic tools depends on easy discovery of what's possible, and shared sessions are how that discovery happens. The limitation is that it is read-only and team-internal — no connection to branches, no retrieval by an agent, no planning docs.

**Claudebin.** A Claude Code plugin and hosted web service that publishes sessions to a URL with a rendered viewer, public/private visibility controls, embeddable session ranges, and a continuation mechanism — a curl command that fetches the shared thread as markdown and pipes it into a new Claude Code session, which summarizes the history and picks up from there. The continuation model is a practical approximation of resumable sessions. The limitation is that it is cloud-hosted and not git-integrated — sessions live on Claudebin's servers rather than traveling with the branch, and there is no connection to the PR lifecycle or agent retrieval.

**What is missing across all of them.** Each existing solution is partial in a specific way. None connect sessions to branches as the organizational unit. None include planning docs alongside session exports. None address RAG-based retrieval by a reviewer's agent. None model the PR as the endpoint of an ongoing collaboration rather than a handoff. None address cross-project reference. And none provide a push/pull distributed model that works across machines without a hosted intermediary. This proposal attempts to address the full lifecycle.

---

## Positioning

GitHub Next's Ace project takes a different approach to the same problem — bringing teammates and coding agents into a shared multiplayer workspace. The instinct is right, but the solution is additive: a new environment that developers must opt into, with a new interface, hosted infrastructure, and implicit tool lock-in. The bet is that if the environment is good enough, developers will migrate to it. That is a legitimate product strategy, but it carries real costs: developers give up their existing tools and workflows, teams must coordinate on a shared platform, and the value is contingent on broad adoption.

This proposal makes the opposite bet: that developers will not abandon their tools, and that the right collaboration layer is one that works with whatever they are already using. The goal is a lightweight, local-first protocol — conventions and small scripts rather than a platform — that adds collaborative value without asking anyone to change their environment. No new interface. No cloud dependency. No lock-in.

The two approaches are complementary rather than competing. Ace optimizes for a rich shared experience for teams willing to standardize on a single environment. This proposal optimizes for flexibility and adoption — a lower floor that works across tools, workflows, and team sizes. If the lightweight approach succeeds, it also produces the artifacts and conventions that a richer interface could build on top of.

---

## Origin: A Pattern That Already Works Locally

The ideas here are not purely theoretical. One of the authors already uses a workflow that approximates this locally: a shell script creates a git worktree for each new feature branch, and an Open Code session is scoped to that worktree's local data directory. The session travels with the worktree. When the branch is done, the session record is there alongside the code.

This works well for a single developer. The proposal is essentially asking what it would take to extend this pattern to a team — across people, machines, and time. The worktree already provides the right isolation boundary. The session is already a file on disk. The missing piece is a way to push and pull that session the way you push and pull the code, with enough structure for others to find and use what's relevant.

---

## Core Insight: The Branch as Collaboration Space

The central shift is treating the **branch**, not the pull request, as the unit of collaboration. Work on a branch is not a private activity that concludes with a PR — it is an ongoing discussion from the moment the branch is created, with the PR as the final checkpoint before merging rather than the beginning of review.

This means conversations happen throughout the life of a branch: exploratory sessions before a line of code is written, design discussions that involve multiple people, implementation sessions, incremental review and feedback. By the time a PR is marked ready, the substantive discussion is largely complete and captured. Formal review becomes lighter — reviewers have been participants all along, or can read the sessions that preceded their involvement.

---

## The Session as the Fundamental Unit

What gets produced throughout this process is a collection of **chat sessions**. Each session has its own participants, timeline, and focus. A branch accumulates many sessions over its lifetime, distinguishable much as chat sessions already are in tools like Claude Code or Cursor today:

- Early exploratory sessions between a developer and their agent
- Design discussions bringing in additional human participants
- Implementation sessions as the work takes shape
- Review sessions with different participants examining the result

The branch becomes the container that groups these sessions. Together they form the record of how the work came to be.

---

## Architecture

### What Goes Where

The design reuses existing layers rather than replacing them, with each doing one job:

**Git hosting (GitHub, GitLab, etc.)** continues to handle what it already handles well: access control, code review approval workflows, and the merge gate. It takes a back seat for discussion but remains authoritative for permissions and final state.

**The branch** is the organizational unit that bounds the conversation corpus. Sessions are tied to a branch, not to individual commits. This keeps the searchable universe of sessions manageable without requiring rigid coupling to specific code states.

**Commit messages** continue to narrate fine-grained code changes.

**The PR description** serves as the high-level summary and state tracker for the branch as a whole — but crucially, it is generated and maintained by the agent from the session record, not written from scratch by the developer. The human edits rather than authors, which is a much lower bar and results in descriptions that are actually accurate and kept current as the branch evolves.

**Chat sessions** are the raw material: the conversations between humans and agents that constitute the real work. These live outside the git repository itself — referenced from the branch rather than committed into it — stored in a purpose-built store suited to their size and structure.

**Semantic search** over the session corpus, bounded by branch, makes the record navigable as it grows.

### Storage and Retrieval

Conversation sessions are substantially larger and structurally different from code. Storing them in the git repository directly is impractical — they would bloat clones, disrupt CI, and impose git's line-diffing semantics on content that doesn't benefit from them. Instead, sessions are **referenced** from the branch, with the content stored separately and fetched on demand.

Retrieval is a RAG problem. The tooling for finding relevant information in large corpora is mature, and the patterns for chunking, embedding, and retrieving are well understood. What is specific to this domain is how sessions are chunked and what metadata accompanies each chunk.

Sessions have natural chunk boundaries that code does not: a question-and-answer exchange, a decision point and its surrounding discussion, a thread about a specific concern. These chunks are semantically coherent and embed well. Metadata alongside each chunk — participants, timestamp, branch, resolution status — enables retrieval to do more than pure semantic matching, allowing an agent to assess whether a past discussion is still relevant or has been superseded.

### Code Pointers

Sessions reference code rather than the reverse. A session contains references to specific commits, files, and lines as they existed at the time of the conversation. This keeps sessions valid as code evolves — a reference to `auth/token.ts` line 47 at commit `a3f9` is a historical record that doesn't break when the file is later refactored.

The inverse — tagging lines of code with session references — would require maintaining those tags as code moves, which is fragile and imposes ongoing maintenance cost.

When an agent retrieves a session chunk containing a code pointer, it can compare that pointer against the current state of the code to assess how much has changed, and therefore how much weight to give the discussion. A conversation about code that has since been significantly refactored carries less authority than one about code that remains unchanged.

### Context Building for an Agent

When an agent opens a branch to do work or conduct a review, it builds context progressively:

1. Read the PR description for high-level intent and current state
2. Optionally scan commit messages for the narrative of how the code evolved
3. Query the session corpus semantically — bounded to this branch — to retrieve discussions relevant to the specific files, functions, or concerns in scope
4. Use code pointers in retrieved sessions to assess currency and relevance
5. Proceed with a grounded understanding of not just what the code does, but why it was written that way

This is how a good engineer builds context before touching unfamiliar code. The architecture makes it possible to do the same thing systematically.

---

## Selective Sharing

Not every part of a conversation should be shared with every participant. A developer might want to share conclusions with a reviewer while keeping exploratory dead ends private. A security reviewer might need to see the security-relevant thread without unrelated implementation detail. Some discussions involve personnel or process considerations that have no place in a permanent record.

The right model is **projection**: before sharing, a participant — or their agent — selects what to include. This is different from a permissions system enforced after the fact. Once a session is shared, it is shared; the discipline happens at the point of sharing.

This creates a natural moment of reflection before pushing a session for others to see: what matters here, what is still uncertain, what is not relevant to this recipient. It is not unlike writing a good PR description, but richer and more targeted.

Sessions that are not shared remain local. A `.gitignore`-equivalent for session artifacts allows ephemeral or private sessions to be explicitly excluded from what gets pushed.

---

## The Workflow in Practice

A developer starts a branch. They open a session with their agent to think through the approach before writing code. That session is tied to the branch.

As they work, they have further sessions — some solo with their agent, some with a colleague who joins to weigh in on a design question. Each session is captured.

A reviewer is brought in. Rather than encountering the code cold, they pull the branch and query the session corpus: what was the intent, what was debated, what was decided, what remains uncertain? Their agent retrieves relevant sessions and presents them alongside the diff. The reviewer adds their own sessions — questions to the agent, discussions with the author — which are pushed back to the shared corpus.

The author pulls the reviewer's sessions. Their agent has the full context of what the reviewer examined and asked. They respond, or their agent responds to the straightforward questions before the author even looks.

By the time the PR is approved, the session corpus is a coherent record of how the work came to be. Future developers encountering this code can query that record. Agents working on related code can retrieve relevant past decisions. The knowledge does not evaporate.

The PR description, maintained by the agent throughout, reflects the work as it actually is — not as it was imagined at the start.

---

## What Is New

None of the individual components described here are novel:

- Chat sessions with agents exist today
- RAG over large corpora is well understood
- Git branching and PR workflows are universal
- Semantic search is mature

What is new is treating the **conversation as a first-class artifact** that travels with the branch, is retrievable by future agents, and spans the full lifecycle of the work rather than being discarded when the coding session ends. And what changes as a result is less technical than cultural: the branch becomes the place where work is understood, not just where code is stored.

---

## Design Philosophy: Provenance Over Convenience

The community projects described in the prior art section all share the same core intuition: sharing chat sessions is useful. They are right. But most of them optimize for immediate usability — get sessions visible to teammates as quickly and simply as possible — without grounding the design in version control. The result is that they solve the short-term problem while leaving the long-term one intact.

This proposal is shaped by a different priority: provenance. The ability to answer, months or years later, who shared what, when, in what state of the codebase, and whether anything has changed since. These are the questions that matter for long-term collaboration, and they are exactly the questions version control was designed to answer. Building on that foundation from the start is harder than building a simple sharing mechanism, but it is much harder to retrofit provenance into a system that didn't account for it.

The design tension this creates is the same one version control has always managed: the complete faithful record versus the curated human-readable narrative. Git resolves this by maintaining both simultaneously. The commit history is the complete record — every change, every state, fully replayable. The commit message is the curated narrative — what the author thought mattered, written for a future reader. Neither replaces the other.

The artifact model here follows the same pattern:

- **Raw session JSONL** is the commit history — complete, faithful, append-only
- **The curated export** is the staged changeset — author-selected, reviewed before sharing
- **The session summary** is the commit message — distilled narrative written at the moment of sharing
- **The planning doc** is the README — living, human-maintained, current state rather than historical record

The local directory structure reflects this philosophy too. Branch-named directories and session files named by ID or timestamp within them are less sophisticated than content-addressable storage, but they are more humane. A developer or agent trying to understand a branch's history should not have to resolve hashes to find what they are looking for. The organization reflects how people think about their work, not how a storage system addresses its objects. Usability and technical architecture are not separable concerns.

---

## Conventions

The architecture described here depends on artifacts existing in consistent, known locations. Without agreed conventions, there is nothing for a reviewer's agent to find, nothing for retrieval to index, and no basis for interoperability across tools. The conventions are therefore a prerequisite to everything else — and importantly, they are something that can be established and used today, independent of how the storage and versioning questions are ultimately resolved.

### Artifact types

Two types of artifacts are produced throughout the life of a branch:

**Session exports** are curated snapshots of chat sessions. The result is a JSONL file representing the portion of the session worth sharing, stored in a session directory named by session ID. Planning docs, summaries, and other generated artifacts may be included in the same session directory.

**Planning docs** are living documents that capture current intent, constraints, and decisions. Unlike session exports, they are updated in place rather than appended to — the current planning doc supersedes the previous one, with filename as identity. The agent proposes updates as work evolves and the human approves. A planning doc always represents a current snapshot, not a historical log. Project-wide context and documentation live in the repository itself, managed by git as first-class collaborative files — a CLAUDE.md, README, or architectural decision records are better homes for shared knowledge than a parallel artifact store.

### Local storage

Artifacts live in a hidden, git-ignored directory at the repo root. The structure is organized by branch, then by session, with each session as its own directory containing all related files:

```
.agent/                              # git-ignored, repo root
  <branch-name>/
    <session-id>/
      info.json                      # tool, author, participants, created, updated, description
      messages.jsonl                 # append-only message log
      summary.md                     # generated at export, human-reviewed
      plan.md                        # optional, current feature intent
      decisions.md                   # optional, resolved choices
```

The session directory is the fundamental unit. Each session has a natural home for all its related artifacts without naming gymnastics. The `info.json` file carries structured metadata — which tool generated the session, the author's git username, other participants, when it was created and last updated, and a short description — separating provenance cleanly from content. `messages.jsonl` is append-only and never modified after export. Planning docs and summaries within the session directory are explicitly mutable, which is visible from their stable filenames.

Replacing content in a previously exported session results in replacement of the session directory rather than a silent mutation — a deliberate action with a visible paper trail.

### Remote storage

Remotely, artifacts live in a cloud bucket mirroring the local directory structure, with a folder per repository:

```
<cloud-bucket>/
  <repo-identifier>/
    <branch-name>/
      <session-id>/
        info.json
        messages.jsonl
        summary.md
        plan.md                      # if present
        decisions.md                 # if present
        ...                          # any other generated artifacts
```

This resolves the remote storage question without touching the git repository — no ref pollution, no history bloat, no LFS complexity. The bucket is a simple file store that mirrors the local structure, navigable directly in any cloud storage browser if needed.

**Cloud versioning.** Boons deliberately avoids write locks or overwrite prevention — sessions are artifacts meant to be created and updated freely. If you want provenance and recovery on the remote side, enable **object versioning** on the cloud bucket. This gives you an undo for accidental overwrites and a complete history of session revisions, analogous to how git stores your commit history. Versioning is a one-time bucket-level setting on all three providers: `aws s3api put-bucket-versioning`, `gcloud storage buckets update`, or Azure's `--versioning-level Enabled`.

### Skills

A small set of skills exposes the storage layer to agents and developers. The core verbs are push and pull, mirroring git's model intentionally:

**`session-save`** — create or update a session directory locally, writing or overwriting `info.json` and any provided artifacts. Used both to initialize a new session and to update an existing one; the session directory makes overwrites safe and explicit.

**`session-push`** — sync one or all local sessions for the current branch to the cloud bucket. The primary sharing mechanism: deliberate, explicit, and decoupled from git push so that developers who are offline or don't need to share agent context can skip it. A git post-push hook may be configured optionally by teams that prefer automatic sync, but this is not the default.

**`session-list`** — list available sessions for a branch in the cloud bucket, returning session IDs and metadata from `info.json` without pulling content. Useful for discovering what exists before deciding what to fetch.

**`session-pull`** — fetch sessions from the cloud bucket to the local `.agent/` directory. Accepts an optional session ID to pull a single session; without it, pulls all sessions for the current branch. `session-list` exists precisely so that pull can be selective.

**`session-load`** — entry point for a reviewer or collaborator picking up work on a branch. Rather than loading all sessions indiscriminately, this follows a workflow: first run `session-list` to retrieve metadata from `info.json` for all branch sessions, then use that metadata to identify which sessions are relevant to the current task, then run `session-pull` selectively to fetch only those. The balance between agent judgment and CLI mechanics in this workflow is an open question: the CLI provides the mechanical operations while the agent exercises relevance judgment, but how much the agent should reason autonomously versus rely on explicit skill invocations is something the prototype will inform.

These skills are documented in the project-level instruction file (`CLAUDE.md` or equivalent) so that any agent entering the project knows they exist and when to use them.

### CLI

The skills are thin wrappers over a lightweight CLI that handles the actual file and cloud operations. This separation means the same operations are available both within an agent session (via skills) and directly from the terminal (via the CLI), composing naturally with existing shell workflows without requiring an agent to be running.

For the prototype, the CLI is a shell script — trivially distributable via curl or a single file committed to the project, and sufficient to validate the approach without committing to a packaging decision. As the tool matures, the right distribution mechanism will become clearer: an npm package is the likely path given the Node-based ecosystem around Claude Code and similar tools, while a single compiled binary would offer broader portability. Both skill and CLI distribution are deferred until there is something proven worth sharing.

### Agent awareness

Beyond the skills themselves, the project-level instruction file tells any agent entering the project:

- Where local session artifacts live and how they are structured
- To run `session-load` when starting work on a branch with existing sessions
- To run `session-save` to update session metadata and artifacts as work evolves
- To propose updates to planning docs when decisions are made or constraints are discovered
- To generate a session summary at export time for human review before pushing

### Selective sharing

Pushing is deliberate, not automatic — sharing should be a conscious act rather than a side effect of other workflow steps. The default path is simply pushing what is in the local session directory when ready to share. Curation is available for sessions that contain private or irrelevant content: the developer reviews the message log, removes what should not be shared, and the agent can assist by proposing a trimmed version and drafting the summary. This capability exists without requiring it to be exercised every time — lightweight by default, with more deliberate curation available when the situation calls for it.

---

## Open Questions

A few areas warrant further thinking:

**Distillation over time.** The per-session summaries and planning docs address much of the distillation problem by design. As session corpora grow across many PRs there may eventually be value in higher-level distillation — canonical statements of decisions still in force across multiple branches — but this is a future concern rather than an active gap in the current design.

**Resolution and closure.** How does a conversation thread get marked as resolved? How does an agent know that a question raised in a session was answered by a subsequent code change? Some lightweight resolution protocol, analogous to closing a GitHub issue, would help prevent old open questions from surfacing indefinitely in retrieval results.

**Notification.** The distributed, async model has no inherent presence or notification mechanism. The CLI is already aware of session metadata including participants and authors, and could handle notification directly when `session-push` is run — parsing mentioned users from the session and notifying them without requiring a separate GitHub Action. GitHub Actions remains an alternative for teams that prefer notification to route through their existing GitHub workflow.

**Concurrent sessions.** The practical model is that each participant maintains their own session directories. Rather than multiple people writing to the same session, a reviewer or collaborator creates their own session on the branch, reads others' sessions as context, and pushes their own. Sessions reference each other rather than being shared mutable objects. This sidesteps the hardest concurrency problems without sacrificing the ability to build on each other's work.

---

## Prototype

The full proposal has many moving parts, but the core hypothesis is narrow enough to test with a minimal implementation: *if session artifacts travel with a branch and are retrievable by another agent, does that agent make meaningful use of them?* Everything else in the design depends on this being true, so it is the right thing to validate first.

### Scope

The prototype tests three things only:

1. **A convention for associating sessions with a branch.** Sessions need a known location that can be found by a push/pull mechanism. The simplest starting point is git worktrees, where each branch gets its own working directory and the agent's session data directory is naturally isolated per branch. This makes the association trivial — the sessions are already in the right place. However, the design should not require worktrees. Other workflows should be able to achieve the same association differently: a branch-aware session naming convention, a config file mapping the current branch to a session directory, or tooling built into the agent. Worktrees are the starting point for the prototype; flexibility is the goal for the design.

2. **Push and pull.** A mechanism for getting session artifacts to and from a shared location. `session-push` and `session-pull` shell scripts sync the local `.agent/<branch>/` directory to a cloud bucket. No new infrastructure beyond a cloud storage bucket is required for the initial test.

3. **Retrieval by a fresh agent session.** A second participant pulls the sessions and opens a new agent session with those artifacts as context. The agent is then asked questions about decisions made in the original session — why a particular approach was chosen, what constraints the author was working under, what the agent flagged as uncertain — without the original author present.

### What Success Looks Like

The prototype succeeds if a fresh agent session, given only the pulled session artifacts, can answer questions about the original work accurately and usefully. The bar is not perfection — it is whether the answers are meaningfully better than reading the code alone, and whether a reviewer would find them valuable.

### What Failure Would Mean

If retrieval is consistently vague or inaccurate, that points to a problem with either session structure (the artifacts don't contain enough signal) or context window management (too much noise for the agent to find what's relevant). Either finding is useful: the first would suggest sessions need richer internal structure, the second would motivate earlier investment in chunking and semantic search rather than naive full-context retrieval.

If the artifacts are accurate but a reviewer wouldn't find them useful — the information is there but not worth the friction of accessing it — that is a more fundamental challenge to the proposal's value and worth knowing early.

### Implementation Path

The implementation is a shell script — the CLI layer described in the conventions section — layered on top of existing tooling. Sessions are written to the local `.agent/<branch>/` directory structure as work progresses. When ready to share, `session-push` syncs the branch directory to a cloud bucket. A second developer runs `session-pull` to fetch those sessions locally, then opens their agent with the artifacts as context. The test is manual: can that agent answer meaningful questions about the work without the original author present?

---

## Tool Compatibility

A critical dependency for this proposal is the ability to export session data from whatever tool produced it into a consistent, portable format. The landscape varies significantly by tool category.

### CLI tools — tractable today

The CLI-first tools share a common pattern: file-based local storage, project-scoped directories, and formats close enough to JSONL that normalization is straightforward. Convergence is happening organically, without coordination.

**Claude Code / Open Code** stores sessions as JSONL files under `~/.claude/projects/`, with each project isolated by directory. The format is human-readable, append-only by construction, and already the basis of the workflow this proposal extends. Community feature requests for project-local storage (sessions living inside the project directory rather than a user-global location) are open and well-supported, suggesting this gap is recognized and likely to close.

**OpenAI Codex CLI** stores session transcripts as JSONL files under `~/.codex/sessions/`, organized by date. The format is essentially identical to Claude Code's in structure. Codex also supports a `--no-persist` flag to run without writing sessions to disk, which is a useful primitive for the selective sharing model described earlier.

**Aider** writes chat history to `.aider.chat.history.md` in the project directory — plain markdown, already project-local, and explicitly designed for portability. The Aider documentation itself suggests sharing sessions by publishing the markdown file. The format requires normalization (markdown rather than JSONL) but the data is completely accessible and the tool's attitude toward sharing is aligned with this proposal.

**Gemini CLI** currently stores sessions as JSON files under `~/.gemini/tmp/<project_hash>/chats/`, scoped by project. An active open proposal in the Gemini CLI repository explicitly proposes migrating to JSONL, citing Claude Code and Codex CLI as the patterns to align with, and describing the same append-only, per-message structure. A `/chat share` command already exports sessions for collaboration. The community has noted that session files are portable and can be shared between teammates directly.

### IDE-integrated tools — opaque and difficult

The IDE-integrated tools present a much harder picture. Sessions are stored in proprietary databases not designed for export, with no official API for accessing them.

**Cursor** spreads session data across multiple SQLite databases — a `~/.cursor/chats/` directory of `store.db` files, a global `state.vscdb` that can exceed 1GB, and workspace-specific state files. Individual messages are keyed by composite IDs inside a `cursorDiskKV` table. Third-party extraction tools exist and the community has reverse-engineered the format, but it is undocumented and subject to change. Forum requests for a project-local `.chathistory` folder have been described as an obvious missing feature.

**GitHub Copilot Chat** has no accessible session storage. There is no public API and no reliable export path. A JSON export feature existed at one point and was quietly removed. The current guidance for saving a conversation is to copy and paste it manually.

**Windsurf** has no documented session export. Open issues requesting chat history export have gone unresolved.

### The dividing line

The split maps almost perfectly onto tool architecture: CLI-first, local-first tools store sessions as files you own; IDE-integrated, cloud-connected tools store sessions in systems you don't control. This is not incidental — it reflects different design philosophies about data ownership.

For this proposal, the practical implication is that a collaboration layer built on CLI tools (Claude Code, Open Code, Codex, Aider, Gemini CLI) is viable today without vendor cooperation. Extending support to Cursor, Copilot, and Windsurf would require either those vendors adopting a common export format or a standard they choose to implement.

A third-party tool called SpecStory already exists that monitors AI assistant databases and auto-saves conversations as markdown files in a `.specstory/history/` directory within the project, normalizing across multiple editors. Its existence as a product confirms the demand and shows the extraction layer is buildable — but a purpose-built standard would be more robust than relying on reverse-engineered database access.

The CLI tools establishing a de facto standard first — through the natural convergence already underway around JSONL and project-scoped storage — may be the most realistic path toward eventual broader adoption. When the format is simple, open, and demonstrated to work, IDE tool vendors have a concrete target to implement rather than an abstract request to "support collaboration."
