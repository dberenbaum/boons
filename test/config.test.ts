import { test, expect, beforeAll, afterAll, describe } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import {
  getRepoKey,
  readConfig,
  writeConfig,
  resolveConfig,
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

describe("readConfig / writeConfig", () => {
  test("readConfig returns empty object when file does not exist", () => {
    const cfg = readConfig(tmpDir)
    expect(cfg).toEqual({})
  })

  test("writeConfig writes config file", () => {
    writeConfig({ remote: { provider: "aws", bucket: "my-bucket" } }, tmpDir)
    const filePath = path.join(tmpDir, ".boons", "config.json")
    expect(fs.existsSync(filePath)).toBe(true)
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    expect(raw).toEqual({ remote: { provider: "aws", bucket: "my-bucket" } })
  })

  test("readConfig reads back the config", () => {
    const cfg = readConfig(tmpDir)
    expect(cfg.remote?.provider).toBe("aws")
    expect(cfg.remote?.bucket).toBe("my-bucket")
  })
})

describe("resolveConfig", () => {
  test("returns per-repo config (may inherit global)", () => {
    const resolved = resolveConfig(tmpDir)
    expect(resolved).not.toBeNull()
    expect(resolved?.remote.provider).toBe("aws")
    expect(resolved?.remote.bucket).toBe("my-bucket")
  })
})
