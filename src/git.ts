export interface Author {
  name: string
  email: string
}

export function getBranch(cwd?: string): string {
  const result = Bun.spawnSync(
    ["git", "rev-parse", "--abbrev-ref", "HEAD"],
    { cwd: cwd ?? process.cwd() },
  )
  return result.stdout.toString().trim()
}

export function getAuthor(cwd?: string): Author {
  const name = Bun.spawnSync(
    ["git", "config", "user.name"],
    { cwd: cwd ?? process.cwd() },
  ).stdout.toString().trim()

  const email = Bun.spawnSync(
    ["git", "config", "user.email"],
    { cwd: cwd ?? process.cwd() },
  ).stdout.toString().trim()

  return { name, email }
}
