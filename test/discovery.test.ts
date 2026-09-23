import { test, expect, describe, beforeEach, afterAll } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  getSessionsBranchDirForKey,
  getSessionsDirForKey,
  listRepoKeys,
  listBranches,
  normalizeRepoKey,
  resolveRepoKey,
} from "../src/cloud/config"
import {
  collectAllPlans,
  collectPlansForKey,
  findPlansByName,
  resolvePlanForKey,
} from "../src/plan"

let baseDir: string

const REPO_A = "github.com/org/api"
const REPO_B = "github.com/org/infra"
const REPO_C = "gitlab.com/group/web"

function seedSession(
  repoKey: string,
  branch: string,
  sessionID: string,
  docs: Record<string, { content: string; savedAt: string; kind?: "plan" | "doc" }>,
  info?: { branch?: string; name?: string },
): void {
  const sessionDir = path.join(getSessionsBranchDirForKey(repoKey, branch, baseDir), sessionID)
  fs.mkdirSync(sessionDir, { recursive: true })
  const manifest = Object.entries(docs).map(([name, d]) => {
    fs.writeFileSync(path.join(sessionDir, name), d.content)
    return {
      name,
      source: `/tmp/${name}`,
      file: name,
      savedAt: d.savedAt,
      kind: d.kind ?? "plan",
    }
  })
  fs.writeFileSync(
    path.join(sessionDir, "plans.json"),
    JSON.stringify(manifest, null, 2),
  )
  if (info) {
    fs.writeFileSync(
      path.join(sessionDir, "info.json"),
      JSON.stringify({ id: sessionID, ...info }, null, 2),
    )
  }
}

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-discovery-test-"))
  seedSession(REPO_A, "main", "s1", {
    "api-plan.md": { content: "# API plan\n", savedAt: "2026-01-01T10:00:00.000Z" },
  })
  seedSession(REPO_A, "feat/auth", "s2", {
    "auth-rollout.md": { content: "# Auth rollout\n", savedAt: "2026-01-02T10:00:00.000Z" },
    "api-plan.md": { content: "# API plan v2\n", savedAt: "2026-01-03T10:00:00.000Z" },
  }, { branch: "feat/auth", name: "Auth work" })
  seedSession(REPO_B, "main", "s3", {
    "infra-notes.md": { content: "# Infra notes\n", savedAt: "2026-01-04T10:00:00.000Z" },
  })
  seedSession(REPO_C, "trunk", "s4", {
    "web-spec.md": { content: "# Web spec\n", savedAt: "2026-01-05T10:00:00.000Z", kind: "doc" },
  })
})

afterAll(() => {
  // per-test tmp dirs are cleaned by the OS; remove the last one for tidiness
})

describe("normalizeRepoKey", () => {
  test("normalizes remote URLs to host/org/repo", () => {
    expect(normalizeRepoKey("https://github.com/org/repo.git")).toBe("github.com/org/repo")
    expect(normalizeRepoKey("git@github.com:org/repo.git")).toBe("github.com/org/repo")
    expect(normalizeRepoKey("ssh://git@gitlab.com/group/project")).toBe("gitlab.com/group/project")
  })

  test("passes through already-normalized keys", () => {
    expect(normalizeRepoKey("github.com/org/repo")).toBe("github.com/org/repo")
    expect(normalizeRepoKey("github.com/org/repo/")).toBe("github.com/org/repo")
  })
})

describe("repo key addressing", () => {
  test("getSessionsDirForKey needs no git repo", () => {
    expect(getSessionsDirForKey(REPO_A, baseDir)).toBe(
      path.join(baseDir, ".boons", "sessions", REPO_A),
    )
  })

  test("listRepoKeys returns every repo with stored sessions", () => {
    expect(listRepoKeys(baseDir)).toEqual([REPO_A, REPO_B, REPO_C].sort())
  })

  test("listRepoKeys reports machine-local repos with sessions", () => {
    seedSession("_local/-home-dave-scratch", "main", "s5", {
      "scratch.md": { content: "# Scratch\n", savedAt: "2026-01-06T10:00:00.000Z" },
    })
    expect(listRepoKeys(baseDir)).toContain("_local/-home-dave-scratch")
  })

  test("listRepoKeys ignores repo dirs with no saved sessions", () => {
    fs.mkdirSync(
      path.join(baseDir, ".boons", "sessions", "github.com", "org", "empty"),
      { recursive: true },
    )
    expect(listRepoKeys(baseDir)).not.toContain("github.com/org/empty")
  })

  test("listBranches returns branches with stored sessions", () => {
    // feat/auth has two path segments; the session's info.json records the
    // full branch name, so the repo key must not swallow the first segment.
    expect(listBranches(REPO_A, baseDir)).toEqual(["feat/auth", "main"])
  })

  test("repo keys survive branch names containing slashes", () => {
    expect(listRepoKeys(baseDir)).toContain(REPO_A)
    expect(listRepoKeys(baseDir)).not.toContain(`${REPO_A}/feat`)
  })

  test("resolveRepoKey accepts a raw URL and reports known keys", () => {
    expect(resolveRepoKey("git@github.com:org/infra.git", baseDir)).toEqual({
      key: REPO_B,
      known: true,
    })
    expect(resolveRepoKey("github.com/org/nope", baseDir)).toEqual({
      key: "github.com/org/nope",
      known: false,
    })
  })
})

describe("collectPlansForKey", () => {
  test("reads another repo's plans for a branch", () => {
    const plans = collectPlansForKey(REPO_B, "main", baseDir)
    expect(plans.map((p) => p.name)).toEqual(["infra-notes.md"])
    expect(plans[0].repoKey).toBe(REPO_B)
    expect(plans[0].branch).toBe("main")
    expect(fs.readFileSync(plans[0].path, "utf-8")).toBe("# Infra notes\n")
  })

  test("resolves the latest version of a plan on a branch", () => {
    const plan = resolvePlanForKey(REPO_A, "main", "api-plan.md", baseDir)
    expect(plan?.sessionID).toBe("s1")
    expect(fs.readFileSync(plan!.path, "utf-8")).toBe("# API plan\n")
  })

  test("resolves a plan on a slash-containing branch", () => {
    const plan = resolvePlanForKey(REPO_A, "feat/auth", "auth-rollout.md", baseDir)
    expect(plan?.sessionID).toBe("s2")
    expect(plan?.branch).toBe("feat/auth")
  })

  test("returns empty for an unknown repo or branch", () => {
    expect(collectPlansForKey("github.com/org/nope", "main", baseDir)).toEqual([])
    expect(collectPlansForKey(REPO_B, "feat/none", baseDir)).toEqual([])
  })
})

describe("collectAllPlans", () => {
  test("searches every repo and branch, newest first", () => {
    const all = collectAllPlans({ baseDir })
    expect(all.map((d) => d.name)).toEqual([
      "web-spec.md",
      "infra-notes.md",
      "api-plan.md", // latest: saved from feat/auth session
      "auth-rollout.md",
      "api-plan.md", // older: main
    ])
    expect(all.map((d) => d.repoKey)).toEqual([
      REPO_C,
      REPO_B,
      REPO_A,
      REPO_A,
      REPO_A,
    ])
  })

  test("branch filter narrows the cross-repo search", () => {
    const mains = collectAllPlans({ baseDir, branch: "main" })
    expect(mains.map((d) => d.name).sort()).toEqual(["api-plan.md", "infra-notes.md"])
  })

  test("can restrict to specific repos", () => {
    const only = collectAllPlans({ baseDir, repoKeys: [REPO_B] })
    expect(only.map((d) => d.name)).toEqual(["infra-notes.md"])
  })
})

describe("findPlansByName", () => {
  test("finds a plan in a different repo than the one searching", () => {
    const hits = findPlansByName("infra-notes.md", { baseDir })
    expect(hits).toHaveLength(1)
    expect(hits[0].repoKey).toBe(REPO_B)
    expect(hits[0].branch).toBe("main")
  })

  test("returns every location for a name, newest first", () => {
    const hits = findPlansByName("api-plan.md", { baseDir })
    expect(hits).toHaveLength(2)
    expect(hits[0].branch).toBe("feat/auth")
    expect(hits[0].sessionID).toBe("s2")
    expect(hits[1].branch).toBe("main")
  })

  test("returns nothing for unknown names", () => {
    expect(findPlansByName("nope.md", { baseDir })).toEqual([])
  })
})

// ─── CLI behavior ──────────────────────────────────────────────
// The command layer is where cross-repo scoping actually happens, so a few
// end-to-end checks guard the wiring (and the regressions found while
// building it: flag values parsed as plan names, missing sessions dirs).

const REPO_ROOT = path.join(import.meta.dir, "..")

function runCli(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(["bun", path.join(REPO_ROOT, "src", "boons.ts"), ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, HOME: baseDir },
  })
  return {
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    exitCode: proc.exitCode,
  }
}

describe("boons plan --all-repos", () => {
  test("lists plans from every repo with repo and branch columns", () => {
    const result = runCli(["plan", "--all-repos"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("Repo")
    expect(result.stdout).toContain("Branch")
    expect(result.stdout).toContain(REPO_B)
    expect(result.stdout).toContain("infra-notes.md")
    expect(result.stdout).toContain("feat/auth")
  })

  test("--json emits repoKey and branch for each doc", () => {
    const result = runCli(["plan", "--all-repos", "--json"])
    const docs = JSON.parse(result.stdout) as { name: string; repoKey: string; branch: string }[]
    expect(docs.length).toBeGreaterThan(0)
    expect(docs.every((d) => d.repoKey && d.branch)).toBe(true)
  })
})

describe("boons plan <name> across repos", () => {
  test("reads another repo's plan and prints its origin", () => {
    const result = runCli(["plan", "infra-notes.md", "--repo", REPO_B, "--branch", "main"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(`${REPO_B}/main`)
    expect(result.stdout).toContain("# Infra notes")
  })

  test("accepts a raw remote URL for --repo", () => {
    const result = runCli([
      "plan",
      "infra-notes.md",
      "--repo",
      "git@github.com:org/infra.git",
      "--branch",
      "main",
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("# Infra notes")
  })

  test("names other locations when the name is ambiguous", () => {
    const result = runCli(["plan", "api-plan.md", "--all-repos"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("exists in 2 locations")
    // Both locations live in the searched repo, on different branches.
    expect(result.stdout).toContain(REPO_A)
    expect(result.stdout).toContain("main")
    expect(result.stdout).toContain("feat/auth")
  })

  test("points at the other repo when the plan is missing here", () => {
    const result = runCli(["plan", "infra-notes.md"])
    expect(result.exitCode).toBe(1)
    const err = result.stderr + result.stdout
    expect(err).toContain(REPO_B)
    expect(err).toContain(`boons plan infra-notes.md --repo ${REPO_B} --branch main`)
  })

  test("hints how to fetch a repo with no local sessions", () => {
    const result = runCli(["plan", "x.md", "--repo", "github.com/org/unknown"])
    expect(result.exitCode).toBe(1)
    const err = result.stderr + result.stdout
    expect(err).toContain("No local sessions")
    expect(err).toContain("boons pull --repo github.com/org/unknown")
  })
})

describe("boons ls", () => {
  test("does not fail when the current repo has no sessions dir", () => {
    const result = runCli(["ls"])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).not.toContain("ENOENT")
  })

  test("--all-repos lists sessions across repos", () => {
    seedSession(REPO_B, "main", "s9", {
      "extra.md": { content: "# Extra\n", savedAt: "2026-01-07T10:00:00.000Z" },
    }, { branch: "main", name: "Infra session" })
    const result = runCli(["ls", "--all-repos"])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain(REPO_B)
    expect(result.stdout).toContain("Infra session")
  })
})

describe("boons plan --session-id", () => {
  test("reads the addressed repo's session, not the current repo's", () => {
    const result = runCli([
      "plan",
      "--session-id",
      "s3",
      "--repo",
      REPO_B,
      "--branch",
      "main",
    ])
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain("infra-notes.md")
    expect(result.stdout).toContain(REPO_B)
  })

  test("does not treat the session id as a plan name", () => {
    const result = runCli([
      "plan",
      "--session-id",
      "no-such-session",
      "--branch",
      "main",
    ])
    // A name lookup for "no-such-session" would fail with a plan-not-found
    // error; a session lookup reports an empty listing instead.
    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('No plan "no-such-session"')
  })
})
