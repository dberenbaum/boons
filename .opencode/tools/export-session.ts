import { tool } from "@opencode-ai/plugin"

export default tool({
  description: "Export the current opencode session to a boons artifact directory (.boons/)",
  args: {},
  async execute(_args, context) {
    const result = await Bun.$`boons export --session-id ${context.sessionID} --json`.text()
    const parsed = JSON.parse(result.trim())
    return `Exported ${parsed.messageCount} messages to ${parsed.dir}`
  },
})
