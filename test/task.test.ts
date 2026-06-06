import { test, expect, beforeAll, afterAll, spyOn } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { getRepoKey } from "../src/cloud/config"
import {
  scriptsDirPath,
  logFilePath,
  envFilePath,
  listScripts,
  getScript,
  readLog,
  readStatus,
  runScript,
  printScripts,
  printCheck,
  printPath,
} from "../src/task"

let tmpDir: string
let tmpHome: string
let repoKey: string

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-task-test-"))
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "boons-task-home-"))

  // Init git repo with a remote origin so getRepoKey works
  Bun.spawnSync(["git", "init"], { cwd: tmpDir })
  Bun.spawnSync(["git", "remote", "add", "origin", "https://github.com/test-org/test-repo.git"], { cwd: tmpDir })
  Bun.spawnSync(["git", "config", "user.name", "Test User"], { cwd: tmpDir })
  Bun.spawnSync(["git", "config", "user.email", "test@example.com"], { cwd: tmpDir })
  fs.writeFileSync(path.join(tmpDir, "README.md"), "")
  Bun.spawnSync(["git", "add", "."], { cwd: tmpDir })
  Bun.spawnSync(["git", "commit", "-m", "init"], {
    cwd: tmpDir,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test User",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test User",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  })

  repoKey = getRepoKey(tmpDir)!
})

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

function scriptsDir(): string {
  return scriptsDirPath(repoKey, tmpHome)
}

test("listScripts returns empty array when no scripts dir", () => {
  const scripts = listScripts(repoKey, tmpHome)
  expect(scripts).toEqual([])
})

test("listScripts enumerates .sh files and parses descriptions", () => {
  const dir = scriptsDir()
  fs.mkdirSync(dir, { recursive: true })

  fs.writeFileSync(
    path.join(dir, "setup.sh"),
    "#!/bin/bash\n# Install project dependencies\nset -euo pipefail\necho setup\n",
  )
  fs.writeFileSync(
    path.join(dir, "test.sh"),
    "# Run tests\npnpm test\n",
  )
  fs.writeFileSync(
    path.join(dir, "README.txt"),
    "not a script",
  )

  const scripts = listScripts(repoKey, tmpHome)
  expect(scripts).toHaveLength(2)
  expect(scripts[0].name).toBe("setup")
  expect(scripts[0].description).toBe("Install project dependencies")
  expect(scripts[1].name).toBe("test")
  expect(scripts[1].description).toBe("Run tests")
})

test("getScript returns null for missing script", () => {
  expect(getScript(repoKey, "nonexistent", tmpHome)).toBeNull()
})

test("getScript finds a script by name", () => {
  const s = getScript(repoKey, "setup", tmpHome)
  expect(s).not.toBeNull()
  expect(s!.name).toBe("setup")
  expect(s!.description).toBe("Install project dependencies")
})

test("runScript executes a script and logs output", () => {
  const result = runScript(repoKey, "setup", { baseDir: tmpHome })
  expect(result.exitCode).toBe(0)
  // Silent on success
  expect(result.output).toBe("")

  // Log file exists with header
  const lp = logFilePath(repoKey, "setup", tmpHome)
  expect(fs.existsSync(lp)).toBe(true)
  const logContent = fs.readFileSync(lp, "utf-8")
  expect(logContent).toMatch(/^# exit: 0\n/)
})

test("readLog returns log content without header", () => {
  const log = readLog(repoKey, "setup", tmpHome)
  expect(log).not.toBeNull()
  expect(log!).not.toContain("# exit:")
  expect(log!.trim()).toBe("setup")
})

test("readStatus returns exit code", () => {
  const status = readStatus(repoKey, "setup", tmpHome)
  expect(status).toBe(0)
})

test("readStatus returns null for missing log", () => {
  expect(readStatus(repoKey, "nonexistent", tmpHome)).toBeNull()
})

test("readLog returns null for missing log", () => {
  expect(readLog(repoKey, "nonexistent", tmpHome)).toBeNull()
})

test("runScript returns error for missing script", () => {
  const result = runScript(repoKey, "nonexistent", { baseDir: tmpHome })
  expect(result.exitCode).toBe(1)
  expect(result.output).toContain('Task script "nonexistent" not found.')
})

test("runScript with verbose shows output", () => {
  const result = runScript(repoKey, "setup", { verbose: true, baseDir: tmpHome })
  expect(result.exitCode).toBe(0)
  expect(result.output).toBeTruthy()
})

test("runScript captures non-zero exit", () => {
  const dir = scriptsDir()
  fs.writeFileSync(
    path.join(dir, "fail.sh"),
    "#!/bin/bash\nexit 42\n",
  )

  const result = runScript(repoKey, "fail", { baseDir: tmpHome })
  expect(result.exitCode).toBe(42)
  // Silent on failure too (caller sees exitCode, reads log)
  expect(result.output).toBe("")

  const status = readStatus(repoKey, "fail", tmpHome)
  expect(status).toBe(42)
})

test(".env vars are sourced before execution", () => {
  const ep = envFilePath(repoKey, tmpHome)
  fs.mkdirSync(path.dirname(ep), { recursive: true })
  fs.writeFileSync(ep, "MY_VAR=hello_from_env\n")
  const dir = scriptsDir()
  fs.writeFileSync(
    path.join(dir, "envtest.sh"),
    "#!/bin/bash\necho $MY_VAR\n",
  )

  const result = runScript(repoKey, "envtest", { baseDir: tmpHome })
  expect(result.exitCode).toBe(0)

  const log = readLog(repoKey, "envtest", tmpHome)
  expect(log!.trim()).toBe("hello_from_env")
})

test("printScripts outputs formatted list", () => {
  const out: string[] = []
  const spy = spyOn(console, "log").mockImplementation((...args) => out.push(args.join(" ")))
  try {
    printScripts(repoKey, tmpHome)
    const joined = out.join("\n")
    expect(joined).toContain("setup")
    expect(joined).toContain("Install project dependencies")
  } finally {
    spy.mockRestore()
  }
})

test("printPath outputs scripts dir", () => {
  const out: string[] = []
  const spy = spyOn(console, "log").mockImplementation((...args) => out.push(args.join(" ")))
  try {
    printPath(repoKey, tmpHome)
    expect(out[0]).toBe(scriptsDir())
  } finally {
    spy.mockRestore()
  }
})

test("printCheck outputs script content", () => {
  const out: string[] = []
  const spy = spyOn(console, "log").mockImplementation((...args) => out.push(args.join(" ")))
  try {
    printCheck(repoKey, tmpHome)
    const joined = out.join("\n")
    expect(joined).toContain("setup")
    expect(joined).toContain("Install project dependencies")
    expect(joined).toContain("echo setup")
  } finally {
    spy.mockRestore()
  }
})
