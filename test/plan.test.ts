import { test, expect, describe, beforeAll, afterAll } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  snapshotFiles,
  collectPlans,
  resolvePlan,
  writePlan,
  readManifest,
  MANIFEST_FILE,
} from "../src/plan"
import { getSessionsBranchDir } from "../src/cloud/config"

let tmpDir: string
let repo: string
let branchDir: string
let branch: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-plan-test-"))
  repo = fs.mkdtempSync(path.join(tmpDir, "repo-"))
  Bun.spawnSync(["git", "init", "-q"], { cwd: repo })
  Bun.spawnSync(
    ["git", "remote", "add", "origin", "https://github.com/org/repo.git"],
    { cwd: repo },
  )
  branch = "feat-x"
  branchDir = getSessionsBranchDir(branch, repo)
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("snapshotFiles", () => {
  test("copies files and records manifest entries", () => {
    const sessionDir = path.join(branchDir, "session-a")
    const plan = path.join(repo, "plan.md")
    fs.writeFileSync(plan, "# Plan A\n")
    fs.writeFileSync(path.join(repo, "decisions.md"), "- decision\n")

    snapshotFiles(sessionDir, [plan, path.join(repo, "decisions.md")])

    expect(fs.existsSync(path.join(sessionDir, "plan.md"))).toBe(true)
    expect(fs.existsSync(path.join(sessionDir, "decisions.md"))).toBe(true)

    const manifest = readManifest(sessionDir)
    expect(manifest).toHaveLength(2)
    const planEntry = manifest.find((e) => e.name === "plan.md")
    expect(planEntry?.source).toBe(plan)
    expect(planEntry?.kind).toBe("plan")
    expect(planEntry?.savedAt).toBeTruthy()
  })

  test("updates existing entry on re-snapshot", () => {
    const sessionDir = path.join(branchDir, "session-a")
    fs.writeFileSync(path.join(repo, "plan.md"), "# Plan A v2\n")
    snapshotFiles(sessionDir, [path.join(repo, "plan.md")])
    const manifest = readManifest(sessionDir)
    const planEntries = manifest.filter((e) => e.name === "plan.md")
    expect(planEntries).toHaveLength(1)
    expect(
      fs.readFileSync(path.join(sessionDir, "plan.md"), "utf-8"),
    ).toBe("# Plan A v2\n")
  })
})

describe("collectPlans", () => {
  test("returns latest version per name across sessions", () => {
    const newDir = path.join(branchDir, "session-b")
    fs.mkdirSync(newDir, { recursive: true })
    fs.writeFileSync(path.join(newDir, "plan.md"), "# Plan B\n")
    fs.writeFileSync(
      path.join(newDir, MANIFEST_FILE),
      JSON.stringify([
        {
          name: "plan.md",
          source: path.join(repo, "plan.md"),
          file: "plan.md",
          savedAt: new Date(Date.now() + 60000).toISOString(),
          kind: "plan",
        },
      ]),
    )

    const plans = collectPlans(branch, repo)
    const plan = plans.find((p) => p.name === "plan.md")
    expect(plan?.sessionID).toBe("session-b")
    expect(fs.readFileSync(plan!.path, "utf-8")).toBe("# Plan B\n")

    const decisions = plans.find((p) => p.name === "decisions.md")
    expect(decisions?.sessionID).toBe("session-a")
  })

  test("resolvePlan returns null when missing", () => {
    expect(resolvePlan(branch, "nope.md", repo)).toBeNull()
  })
})

describe("writePlan", () => {
  test("creates a plan-only dir when no session exists", () => {
    const loneBranch = "lone-branch"
    const loneDir = getSessionsBranchDir(loneBranch, repo)
    const { dir, entry } = writePlan(loneBranch, { name: "spec.md", content: "spec" }, repo)
    expect(fs.readFileSync(path.join(dir, entry.name), "utf-8")).toBe("spec")
    expect(fs.existsSync(path.join(loneDir, entry.name, "..", "info.json"))).toBe(false)
    const plans = collectPlans(loneBranch, repo)
    expect(plans.map((p) => p.name)).toEqual(["spec.md"])
  })

  test("writes into the most recent session dir when one exists", () => {
    const latestDir = path.join(branchDir, "session-c")
    fs.mkdirSync(latestDir, { recursive: true })
    fs.writeFileSync(
      path.join(latestDir, "info.json"),
      JSON.stringify({ updated: "2026-07-31T12:00:00.000Z" }),
    )

    const { entry } = writePlan(branch, { name: "todo.md", content: "items" }, repo)
    expect(path.basename(entry.name)).toBe("todo.md")
    expect(fs.readFileSync(path.join(latestDir, "todo.md"), "utf-8")).toBe("items")
    const todo = resolvePlan(branch, "todo.md", repo)
    expect(todo?.sessionID).toBe("session-c")
  })
})
