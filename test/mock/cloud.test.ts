import { test, expect, describe, beforeAll, afterAll, mock } from "bun:test"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import type { CloudStorage } from "../../src/cloud/provider"

// ─── Mock Providers ────────────────────────────────────────────

const uploadedDirs: { localDir: string; remoteDir: string }[] = []
const downloadedDirs: { remoteDir: string; localDir: string }[] = []
const listedBases: string[] = []
const downloadedFiles: { remotePath: string; localPath: string }[] = []
let listDirsResult: string[] = ["sess-1", "sess-2"]

class MockPushPullProvider implements CloudStorage {
  readonly name = "mock"
  async uploadDir(localDir: string, remoteDir: string): Promise<void> {
    uploadedDirs.push({ localDir, remoteDir })
  }
  async downloadDir(remoteDir: string, localDir: string): Promise<void> {
    downloadedDirs.push({ remoteDir, localDir })
    fs.mkdirSync(localDir, { recursive: true })
  }
  async listDirs(remoteBase: string): Promise<string[]> {
    listedBases.push(remoteBase)
    return listDirsResult
  }
  async downloadFile(_remotePath: string, _localPath: string): Promise<void> {}
  async checkConfig(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true }
  }
}

class MockListProvider implements CloudStorage {
  readonly name = "mock"
  async uploadDir(_localDir: string, _remoteDir: string): Promise<void> {}
  async downloadDir(_remoteDir: string, _localDir: string): Promise<void> {}
  async listDirs(remoteBase: string): Promise<string[]> {
    listedBases.push(remoteBase)
    return ["sess-a", "sess-b"]
  }
  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    downloadedFiles.push({ remotePath, localPath })
    const info = {
      name: remotePath.includes("sess-a") ? "Session A" : "Session B",
      author: remotePath.includes("sess-a") ? "Alice" : "Bob",
      created: 1736880000000,
      messageCount: remotePath.includes("sess-a") ? 5 : 3,
    }
    fs.writeFileSync(localPath, JSON.stringify(info))
  }
  async checkConfig(): Promise<{ ok: boolean; error?: string }> {
    return { ok: true }
  }
}

// ─── Mocks ─────────────────────────────────────────────────────

let useListProvider = false
let pushTmpDir = ""

const mockGetSessionsBranchDir = (branch: string) => {
  if (pushTmpDir) return path.join(pushTmpDir, "sessions", branch)
  return path.join("/tmp", "boons-sessions", branch)
}

mock.module("../../src/cloud/config", () => ({
  resolveConfig: () => ({
    remote: {
      provider: "mock",
      bucket: "test-bucket",
      ...(useListProvider ? { prefix: "boons" } : {}),
    },
    source: "test",
  }),
  getRepoKey: () => "github.com/org/repo",
  getSessionsDir: () => pushTmpDir ? path.join(pushTmpDir, "sessions") : "/tmp/boons-sessions",
  getSessionsBranchDir: (branch: string) => mockGetSessionsBranchDir(branch),
  boonsDataDir: () => pushTmpDir ? path.join(pushTmpDir, "boons") : "/tmp/boons",
  getRepoKeyOrLocal: () => ({ key: "github.com/org/repo", isLocal: false }),
  readGlobalConfig: () => ({}),
  writeGlobalConfig: () => {},
  globalConfigPath: () => "/tmp/config.json",
}))

mock.module("../../src/git", () => ({
  getBranch: () => "feature-test",
  getAuthor: () => ({ name: "Test User", email: "test@example.com" }),
}))

mock.module("../../src/cloud/factory", () => ({
  createProvider: () =>
    useListProvider ? new MockListProvider() : new MockPushPullProvider(),
}))

// ─── Import modules under test ─────────────────────────────────

import { push } from "../../src/cloud/push"
import { pull } from "../../src/cloud/pull"
import { listRemote } from "../../src/cloud/remote-list"

// ─── Push Tests ────────────────────────────────────────────────

describe("push", () => {
  let tmpDir: string

  beforeAll(() => {
    useListProvider = false
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-push-test-"))
    pushTmpDir = tmpDir
    const sessionsDir = mockGetSessionsBranchDir("feature-test")
    fs.mkdirSync(path.join(sessionsDir, "sess-1"), { recursive: true })
    fs.mkdirSync(path.join(sessionsDir, "sess-2"), { recursive: true })
    fs.writeFileSync(
      path.join(sessionsDir, "sess-1", "info.json"),
      JSON.stringify({ name: "Session 1" }),
    )
    fs.writeFileSync(
      path.join(sessionsDir, "sess-2", "info.json"),
      JSON.stringify({ name: "Session 2" }),
    )
  })

  afterAll(() => {
    pushTmpDir = ""
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("pushes all sessions for branch", async () => {
    uploadedDirs.length = 0
    const result = await push({ directory: tmpDir })
    expect(result.pushed).toBe(2)
    expect(result.sessions.sort()).toEqual(["sess-1", "sess-2"])
    expect(result.branch).toBe("feature-test")
    expect(uploadedDirs.length).toBe(2)
  })

  test("pushes specific session when sessionID is given", async () => {
    uploadedDirs.length = 0
    const result = await push({ directory: tmpDir, sessionID: "sess-1" })
    expect(result.pushed).toBe(1)
    expect(result.sessions).toEqual(["sess-1"])
    expect(uploadedDirs.length).toBe(1)
  })

  test("throws when no sessions found", async () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-empty-"))
    pushTmpDir = emptyDir
    expect(push({ directory: emptyDir })).rejects.toThrow("No saved sessions found")
    pushTmpDir = tmpDir
    fs.rmSync(emptyDir, { recursive: true, force: true })
  })
})

// ─── Pull Tests ────────────────────────────────────────────────

describe("pull", () => {
  let tmpDir: string

  beforeAll(() => {
    useListProvider = false
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boons-pull-test-"))
    pushTmpDir = tmpDir
  })

  afterAll(() => {
    pushTmpDir = ""
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  test("pulls all remote sessions for branch", async () => {
    downloadedDirs.length = 0
    listedBases.length = 0
    const result = await pull({ directory: tmpDir })
    expect(result.pulled).toBe(2)
    expect(result.sessions.sort()).toEqual(["sess-1", "sess-2"])
    expect(result.branch).toBe("feature-test")
    expect(listedBases[0]).toContain("github.com/org/repo/feature-test")
    expect(downloadedDirs.length).toBe(2)
  })

  test("pulls specific session when sessionID is given", async () => {
    downloadedDirs.length = 0
    const result = await pull({ directory: tmpDir, sessionID: "sess-2" })
    expect(result.pulled).toBe(1)
    expect(result.sessions).toEqual(["sess-2"])
    expect(downloadedDirs.length).toBe(1)
  })
})

// ─── Remote List Tests ─────────────────────────────────────────

describe("listRemote", () => {
  beforeAll(() => {
    useListProvider = true
  })

  test("lists remote sessions", async () => {
    downloadedFiles.length = 0
    listedBases.length = 0
    const sessions = await listRemote({ directory: "/tmp" })
    expect(sessions.length).toBe(2)
    expect(sessions[0].sessionID).toBe("sess-a")
    expect(sessions[0].name).toBe("Session A")
    expect(sessions[0].author).toBe("Alice")
    expect(sessions[0].messageCount).toBe(5)
    expect(sessions[0].created).toBeTruthy()

    expect(sessions[1].sessionID).toBe("sess-b")
    expect(sessions[1].name).toBe("Session B")
    expect(sessions[1].author).toBe("Bob")
    expect(sessions[1].messageCount).toBe(3)

    expect(listedBases.length).toBe(1)
    expect(listedBases[0]).toContain("github.com/org/repo/feature-test")
    expect(listedBases[0]).toContain("boons")
  })
})
