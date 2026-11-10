// OpenSlimedit entry point for both OpenCode plugin APIs.
//
// The default export carries both contracts:
//   server(input)  - OpenCode 1.x. The 1.x loader reads `id` and `server` and ignores `setup`.
//   setup(ctx)     - OpenCode 2.x. The 2.x loader requires `id` and `setup`.
//
// Every hook is fail-open: on any error the original tool behavior is kept.
import { SLIM, compactEditOutput, compactReadOutput, expandLineRange } from "./core.ts"

const ID = "openslimedit"

function disabled(): boolean {
  return process.env.OPENSLIMEDIT_DISABLED === "1"
}

// ---------------------------------------------------------------------------
// OpenCode 1.x
// ---------------------------------------------------------------------------
async function server({ directory }: { directory: string }) {
  if (disabled()) return {}
  return {
    // Shorten built-in tool descriptions
    "tool.definition": async (input: any, output: any) => {
      try {
        if (SLIM[input.toolID]) output.description = SLIM[input.toolID]
      } catch {}
    },

    // Compact read and edit output
    "tool.execute.after": async (input: any, output: any) => {
      try {
        if (typeof output?.output !== "string") return
        if (input.tool === "edit") output.output = compactEditOutput(output.output)
        else if (input.tool === "read") output.output = compactReadOutput(output.output, directory)
      } catch {}
    },

    // Expand line ranges in oldString
    "tool.execute.before": async (input: any, output: any) => {
      try {
        if (input.tool === "edit") expandLineRange(output.args, directory)
      } catch {}
    },
  }
}

// ---------------------------------------------------------------------------
// OpenCode 2.x
// ---------------------------------------------------------------------------
async function setup(ctx: any) {
  if (disabled()) return
  const directory: string = ctx?.location?.directory || process.cwd()

  // Shorten tool descriptions sent to the model
  await ctx.session.hook("context", (event: any) => {
    try {
      for (const [name, description] of Object.entries(SLIM)) {
        const tool = event.tools?.[name]
        if (tool) tool.description = description
      }
    } catch {}
  })

  // Expand line ranges in oldString
  await ctx.tool.hook("execute.before", (event: any) => {
    try {
      if (event.tool === "edit") event.input = expandLineRange(event.input, directory)
    } catch {}
  })

  // Compact read and edit output. Result text is either a string or the
  // first text part of a content array.
  await ctx.tool.hook("execute.after", (event: any) => {
    try {
      if (event.status !== "completed") return
      if (event.tool !== "edit" && event.tool !== "read") return
      const result = event.result
      if (!result || result.content == null) return

      const transform = (text: string) =>
        event.tool === "edit" ? compactEditOutput(text) : compactReadOutput(text, directory)

      if (typeof result.content === "string") {
        const next = transform(result.content)
        if (next !== result.content) event.result = { ...result, content: next }
        return
      }
      if (Array.isArray(result.content)) {
        const i = result.content.findIndex((p: any) => p?.type === "text" && typeof p.text === "string")
        if (i < 0) return
        const next = transform(result.content[i].text)
        if (next === result.content[i].text) return
        const content = [...result.content]
        content[i] = { ...content[i], text: next }
        event.result = { ...result, content }
      }
    } catch {}
  })
}

export default { id: ID, server, setup }
