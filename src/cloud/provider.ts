export interface CloudStorage {
  readonly name: string
  uploadDir(localDir: string, remoteDir: string): Promise<void>
  downloadDir(remoteDir: string, localDir: string): Promise<void>
  listDirs(remoteBase: string): Promise<string[]>
  downloadFile(remotePath: string, localPath: string): Promise<void>
  checkConfig(): Promise<{ ok: boolean; error?: string }>
}
