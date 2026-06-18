import { test, expect, beforeAll, afterAll, describe } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  getRepoKey,
  resolveConfig,
  getSessionsDir,
  getSessionsBranchDir,
  boonsDataDir,
  getRepoKeyOrLocal,
} from "../src/cloud/config"

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-config-test-"))
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("getRepoKey", () => {
  test("parses HTTPS URL", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-https-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    Bun.spawnSync(["git", "remote", "add", "origin", "https://github.com/org/repo.git"], { cwd: repo })
    const key = getRepoKey(repo)
    expect(key).toBe("github.com/org/repo")
    fs.rmSync(repo, { recursive: true, force: true })
  })

  test("parses SSH URL", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-ssh-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    Bun.spawnSync(["git", "remote", "add", "origin", "git@github.com:org/repo.git"], { cwd: repo })
    const key = getRepoKey(repo)
    expect(key).toBe("github.com/org/repo")
    fs.rmSync(repo, { recursive: true, force: true })
  })

  test("parses URL without .git suffix", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-no-git-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    Bun.spawnSync(["git", "remote", "add", "origin", "https://gitlab.com/group/project"], { cwd: repo })
    const key = getRepoKey(repo)
    expect(key).toBe("gitlab.com/group/project")
    fs.rmSync(repo, { recursive: true, force: true })
  })

  test("parses URL with trailing slash", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-trailing-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    Bun.spawnSync(["git", "remote", "add", "origin", "https://example.com/a/b/"], { cwd: repo })
    const key = getRepoKey(repo)
    expect(key).toBe("example.com/a/b")
    fs.rmSync(repo, { recursive: true, force: true })
  })

  test("returns null when no remote origin", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-no-remote-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    const key = getRepoKey(repo)
    expect(key).toBeNull()
    fs.rmSync(repo, { recursive: true, force: true })
  })
})

describe("boonsDataDir", () => {
  test("returns path under given baseDir", () => {
    const dir = boonsDataDir(tmpDir)
    expect(dir).toBe(path.join(tmpDir, ".boons"))
  })
})

describe("getSessionsDir / getSessionsBranchDir", () => {
  test("returns repo-keyed path when remote exists", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-sess-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    Bun.spawnSync(["git", "remote", "add", "origin", "https://github.com/user/proj.git"], { cwd: repo })
    const dir = getSessionsDir(repo, tmpDir)
    expect(dir).toBe(path.join(tmpDir, ".boons", "sessions", "github.com/user/proj"))
  })

  test("returns local-keyed path when no remote", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-noremote-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    const dir = getSessionsDir(repo, tmpDir)
    expect(dir).toContain("_local")
    expect(dir).toContain("boons")
  })

  test("getSessionsBranchDir appends branch", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-branch-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    const dir = getSessionsBranchDir("my-feature", repo, tmpDir)
    expect(dir).toContain("my-feature")
  })
})

describe("getRepoKeyOrLocal", () => {
  test("returns repo key when remote exists", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-kol-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    Bun.spawnSync(["git", "remote", "add", "origin", "https://github.com/org/repo.git"], { cwd: repo })
    const result = getRepoKeyOrLocal(repo)
    expect(result.key).toBe("github.com/org/repo")
    expect(result.isLocal).toBe(false)
  })

  test("returns local key when no remote", () => {
    const repo = fs.mkdtempSync(path.join(tmpDir, "repo-kol-local-"))
    Bun.spawnSync(["git", "init"], { cwd: repo })
    const result = getRepoKeyOrLocal(repo)
    expect(result.isLocal).toBe(true)
    expect(result.key).toContain("_local")
  })
})

describe("resolveConfig", () => {
  test("reads global config", () => {
    const resolved = resolveConfig(tmpDir)
    // Reads from ~/.config/boons/config.json (may be null if none exists)
    // Just verify it doesn't throw
    expect(resolved === null || typeof resolved === "object").toBe(true)
  })
})
