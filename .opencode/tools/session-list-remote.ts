import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "List remote sessions available for the current branch",
  args: {
    branch: { description: "Branch to list sessions for (default: current)", required: false },
  },
  async execute(args) {
    const parts = ["boons", "ls", "--remote", "--json"]
    if (args.branch) parts.push("--branch", args.branch)
    const result = await Bun.$`${parts}`.text()
    return result.trim()
  },
})
