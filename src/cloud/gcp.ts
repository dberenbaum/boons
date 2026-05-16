import { CloudStorage } from "./provider"

export interface GcpConfig {
  bucket: string
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
    throw new Error(`gsutil not found. Install from https://cloud.google.com/storage/docs/gsutil`)
  }
}

export class GcpStorage implements CloudStorage {
  readonly name = "gcp"

  private bucket: string

  constructor(config: GcpConfig) {
    this.bucket = config.bucket
  }

  private gsuri(path: string): string {
    return `gs://${this.bucket}/${path}`
  }

  async uploadDir(localDir: string, remoteDir: string): Promise<void> {
    const result = run(["gsutil", "-q", "rsync", "-r", localDir + "/", this.gsuri(remoteDir) + "/"])
    if (result.exitCode !== 0) {
      throw new Error(`gsutil rsync failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
  }

  async downloadDir(remoteDir: string, localDir: string): Promise<void> {
    const result = run(["gsutil", "-q", "rsync", "-r", this.gsuri(remoteDir) + "/", localDir + "/"])
    if (result.exitCode !== 0) {
      throw new Error(`gsutil rsync failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
  }

  async listDirs(remoteBase: string): Promise<string[]> {
    const result = run(["gsutil", "-q", "ls", this.gsuri(remoteBase) + "/"])
    if (result.exitCode !== 0) {
      if (result.stderr.includes("CommandException: One or more URLs matched no objects")) {
        return []
      }
      throw new Error(`gsutil ls failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
    const dirs: string[] = []
    for (const line of result.stdout.split("\n")) {
      const trimmed = line.trim()
      if (trimmed.endsWith("/")) {
        const parts = trimmed.replace(/\/$/, "").split("/")
        dirs.push(parts[parts.length - 1])
      }
    }
    return dirs
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const result = run(["gsutil", "-q", "cp", this.gsuri(remotePath), localPath])
    if (result.exitCode !== 0) {
      throw new Error(`gsutil cp failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
  }

  async checkConfig(): Promise<{ ok: boolean; error?: string }> {
    const result = run(["gsutil", "-q", "ls", this.gsuri("")])
    if (result.exitCode !== 0) {
      return { ok: false, error: result.stderr.trim() || `exit code ${result.exitCode}` }
    }
    return { ok: true }
  }
}
