import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "List remote sessions available for the current branch",
  args: {
    branch: tool.schema.string().optional(),
  },
  async execute(args) {
    const result = await Bun.$`boons ls --remote --json ${args.branch ? ["--branch", args.branch] : []}`.text()
    return result.trim()
  },
})
