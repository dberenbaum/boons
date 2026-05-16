import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Push session artifacts for the current branch to the cloud bucket",
  args: {
    sessionId: { description: "Specific session ID to push", required: false },
    branch: { description: "Branch to push sessions for (default: current)", required: false },
  },
  async execute(args) {
    const parts = ["boons", "push"]
    if (args.branch) parts.push("--branch", args.branch)
    if (args.sessionId) parts.push("--session-id", args.sessionId)
    const result = await Bun.$`${parts}`.text()
    return result.trim()
  },
})
