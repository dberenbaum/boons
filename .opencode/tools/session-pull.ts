import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Pull session artifacts for the current branch from the cloud bucket",
  args: {
    sessionId: { description: "Specific session ID to pull", required: false },
    branch: { description: "Branch to pull sessions for (default: current)", required: false },
  },
  async execute(args) {
    const parts = ["boons", "pull"]
    if (args.branch) parts.push("--branch", args.branch)
    if (args.sessionId) parts.push("--session-id", args.sessionId)
    const result = await Bun.$`${parts}`.text()
    return result.trim()
  },
})
