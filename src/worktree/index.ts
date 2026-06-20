import { register, unregister, listWorktrees, getServicePort, getWorktreeEnv } from "./registry"

function parseArgs(args: string[]): Record<string, string | string[]> {
  const opts: Record<string, string | string[]> = {}
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith("--")) {
      const val = args[i + 1]
      if (val !== undefined && !val.startsWith("--")) {
        opts[a] = val
        i++
      } else {
        opts[a] = "true"
      }
    } else if (a.startsWith("-") && a.length === 2) {
      opts[a] = "true"
    }
  }
  return opts
}

function printEnv(env: Record<string, string>): void {
  for (const [key, val] of Object.entries(env)) {
    console.log(`export ${key}=${val}`)
  }
}

export async function handleWorktree(args: string[]): Promise<void> {
  const sub = args[0]
  const opts = parseArgs(args.slice(1))
  const asJson = opts["--json"] === "true"
  const cwd = process.cwd()

  if (!sub || sub === "--help") {
    console.log(`boons worktree — manage worktree resource allocations

Usage:
  boons worktree register          Allocate ports for this worktree
  boons worktree unregister        Release ports for this worktree
  boons worktree list [--json]     List all registered worktrees
  boons worktree port <service>    Show allocated port for a service
  boons worktree env               Print export statements for worktree vars
  boons worktree prune             Remove stale entries from the registry`)
    return
  }

  switch (sub) {
    case "register": {
      const result = register(cwd)
      if (!result.success) {
        console.error(result.error)
        process.exit(1)
      }
      const env = getWorktreeEnv(cwd)
      if (env) {
        console.log(`Registered worktree. Environment:`)
        printEnv(env)
      } else {
        console.log("Registered worktree.")
      }
      break
    }

    case "unregister": {
      const result = unregister(cwd)
      if (!result.success) {
        console.error(result.error)
        process.exit(1)
      }
      console.log("Unregistered worktree.")
      break
    }

    case "list": {
      const entries = listWorktrees(cwd)
      if (asJson) {
        console.log(JSON.stringify(entries, null, 2))
        return
      }
      if (entries.length === 0) {
        console.log("No registered worktrees.")
        return
      }
      const branchWidth = Math.max(...entries.map((e) => e.branch.length), 6)
      const pathWidth = Math.max(...entries.map((e) => e.worktreePath.length), 4)
      const header = ["Branch".padEnd(branchWidth), "Path".padEnd(pathWidth), "Ports"].join("  ")
      console.log(header)
      console.log("─".repeat(header.length))
      for (const e of entries) {
        const portStr = Object.entries(e.ports)
          .map(([name, port]) => `${name}=${port}`)
          .join(", ")
        console.log(`${e.branch.padEnd(branchWidth)}  ${e.worktreePath.padEnd(pathWidth)}  ${portStr}`)
      }
      break
    }

    case "port": {
      const service = args[1]
      if (!service) {
        console.error("Usage: boons worktree port <service>")
        process.exit(1)
      }
      const port = getServicePort(service, cwd)
      if (port === null) {
        console.error(`No port allocated for service "${service}". Run \`boons worktree register\` first.`)
        process.exit(1)
      }
      console.log(port)
      break
    }

    case "env": {
      const env = getWorktreeEnv(cwd)
      if (!env) {
        console.error("No worktree allocations found. Run `boons worktree register` first.")
        process.exit(1)
      }
      printEnv(env)
      break
    }

    case "prune": {
      const entries = listWorktrees(cwd)
      const count = entries.length
      console.log(`Pruned stale entries. ${count} worktree(s) remain.`)
      break
    }

    default:
      console.error(`Unknown worktree subcommand: ${sub}`)
      process.exit(1)
  }
}
