import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Push session artifacts for the current branch to the cloud bucket",
  args: {
    sessionId: tool.schema.string().optional(),
    branch: tool.schema.string().optional(),
  },
  async execute(args) {
    const result = await Bun.$`boons push ${args.branch ? ["--branch", args.branch] : []} ${args.sessionId ? ["--session-id", args.sessionId] : []}`.text()
    return result.trim()
  },
})
