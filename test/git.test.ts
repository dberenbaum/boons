import { test, expect, beforeAll, afterAll } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { getBranch, getAuthor } from "../src/git"

let tmpDir: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-git-test-"))
  Bun.spawnSync(["git", "init"], { cwd: tmpDir })
  Bun.spawnSync(["git", "config", "user.name", "Test User"], { cwd: tmpDir })
  Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd: tmpDir })
  // Create an initial commit so HEAD resolves to a branch
  fs.writeFileSync(path.join(tmpDir, "README.md"), "")
  Bun.spawnSync(["git", "add", "."], { cwd: tmpDir })
  Bun.spawnSync(["git", "commit", "-m", "init"], { cwd: tmpDir, env: { ...process.env, GIT_AUTHOR_NAME: "Test User", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test User", GIT_COMMITTER_EMAIL: "test@example.com" } })
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

test("getBranch returns the current branch name", () => {
  const branch = getBranch(tmpDir)
  expect(branch).toBe("main")
})

test("getBranch works after switching branches", () => {
  Bun.spawnSync(["git", "checkout", "-b", "feature/test"], { cwd: tmpDir })
  const branch = getBranch(tmpDir)
  expect(branch).toBe("feature/test")
})

test("getAuthor returns user name and email", () => {
  const author = getAuthor(tmpDir)
  expect(author.name).toBe("Test User")
  expect(author.email).toBe("test@example.com")
})
