import { CloudStorage } from "./provider"

export interface AwsConfig {
  bucket: string
  region?: string
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
    throw new Error(`aws CLI not found. Install from https://aws.amazon.com/cli/`)
  }
}

export class AwsStorage implements CloudStorage {
  readonly name = "aws"

  private bucket: string

  constructor(config: AwsConfig) {
    this.bucket = config.bucket
  }

  private s3uri(path: string): string {
    return `s3://${this.bucket}/${path}`
  }

  async uploadDir(localDir: string, remoteDir: string): Promise<void> {
    const result = run([
      "aws", "--only-show-errors", "s3", "sync", localDir + "/", this.s3uri(remoteDir) + "/",
      "--exact-timestamps",
    ])
    if (result.exitCode !== 0) {
      throw new Error(`aws s3 sync failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
  }

  async downloadDir(remoteDir: string, localDir: string): Promise<void> {
    const result = run([
      "aws", "--only-show-errors", "s3", "sync", this.s3uri(remoteDir) + "/", localDir + "/",
      "--exact-timestamps",
    ])
    if (result.exitCode !== 0) {
      throw new Error(`aws s3 sync failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
  }

  async listDirs(remoteBase: string): Promise<string[]> {
    const result = run([
      "aws", "s3", "ls", this.s3uri(remoteBase) + "/",
    ])
    if (result.exitCode !== 0) {
      throw new Error(`aws s3 ls failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
    const dirs: string[] = []
    for (const line of result.stdout.split("\n")) {
      const m = line.match(/^\s*PRE\s+(.+)\/$/)
      if (m) dirs.push(m[1])
    }
    return dirs
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    const result = run([
      "aws", "--only-show-errors", "s3", "cp", this.s3uri(remotePath), localPath,
    ])
    if (result.exitCode !== 0) {
      throw new Error(`aws s3 cp failed: ${result.stderr.trim() || `exit code ${result.exitCode}`}`)
    }
  }

  async checkConfig(): Promise<{ ok: boolean; error?: string }> {
    const result = run(["aws", "s3", "ls", this.s3uri("")])
    if (result.exitCode !== 0) {
      return { ok: false, error: result.stderr.trim() || `exit code ${result.exitCode}` }
    }
    return { ok: true }
  }
}
