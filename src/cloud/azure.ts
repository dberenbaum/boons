import { CloudStorage } from "./provider"

export interface AzureConfig {
  account: string
  container: string
}

function run(args: string[]): { exitCode: number; stdout: string; stderr: string } {
  try {
    const result = Bun.spawnSync(args)
    return {
      exitCode: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    }
  } catch (err) {
    throw new Error(`azcopy not found. Install from https://docs.microsoft.com/en-us/azure/storage/common/storage-use-azcopy-v10`)
  }
}

export class AzureStorage implements CloudStorage {
  readonly name = "azure"

  private baseUrl: string

  constructor(config: AzureConfig) {
    this.baseUrl = `https://${config.account}.blob.core.windows.net/${config.container}`
  }

  private blobUrl(path: string): string {
    return `${this.baseUrl}/${path}`
  }

  async uploadDir(localDir: string, remoteDir: string): Promise<void> {
    const result = run([
      "azcopy", "sync", `${localDir}/*`, this.blobUrl(remoteDir) + "/",
      "--recursive", "--put-md5",
    ])
    if (result.exitCode !== 0) {
      throw new Error(`azcopy sync failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
  }

  async downloadDir(remoteDir: string, localDir: string): Promise<void> {
    const result = run([
      "azcopy", "sync", this.blobUrl(remoteDir) + "/", localDir + "/",
      "--recursive",
    ])
    if (result.exitCode !== 0) {
      throw new Error(`azcopy sync failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
  }

  async listDirs(remoteBase: string): Promise<string[]> {
    const result = run(["azcopy", "list", this.blobUrl(remoteBase) + "/"])
    if (result.exitCode !== 0) {
      throw new Error(`azcopy list failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
    const dirs = new Set<string>()
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.startsWith('"') || trimmed.includes("INFO:")) continue
      if (trimmed.endsWith("/") || trimmed.includes("/")) {
        const parts = trimmed.replace("/", "/").split("/")
        if (parts.length > 1) {
          dirs.add(parts[0])
        }
      }
    }
    return [...dirs]
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const result = run(["azcopy", "copy", this.blobUrl(remotePath), localPath])
    if (result.exitCode !== 0) {
      throw new Error(`azcopy copy failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
  }

  async checkConfig(): Promise<{ ok: boolean; error?: string }> {
    const result = run(["azcopy", "list", this.baseUrl + "/"])
    if (result.exitCode !== 0) {
      return { ok: false, error: result.stderr.trim() || `exit code ${result.exitCode}` }
    }
    return { ok: true }
  }
}
