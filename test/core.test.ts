import { test } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { compactEditOutput, compactReadOutput, expandLineRange, SLIM } from "../src/core.ts"
import plugin from "../src/index.ts"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openslimedit-"))
const file = path.join(dir, "a.txt")
fs.writeFileSync(file, "one\ntwo\nthree\nfour\n")

test("default export carries both plugin contracts", () => {
  assert.equal(plugin.id, "openslimedit")
  assert.equal(typeof plugin.server, "function")
  assert.equal(typeof plugin.setup, "function")
})

test("1.x edit output keeps LSP diagnostics", () => {
  assert.equal(compactEditOutput("Edit applied successfully."), "OK")
  const withLsp = "Edit applied successfully.\n\nLSP errors detected in this file, please fix:\n<diagnostics>x</diagnostics>"
  assert.equal(compactEditOutput(withLsp), "OK\n\nLSP errors detected in this file, please fix:\n<diagnostics>x</diagnostics>")
})

test("2.x edit output becomes OK", () => {
  assert.equal(compactEditOutput("Edited /p/a.ts (1 replacement)"), "OK")
  assert.equal(compactEditOutput("Edited /p/a.ts (3 replacements)"), "OK")
  assert.equal(compactEditOutput("Could not find oldString in a.ts"), "Could not find oldString in a.ts")
})

test("1.x read output is compacted", () => {
  const raw = `<path>${file}</path>\n<type>file</type>\n<content>\n1: one\n\n(End of file - total 4 lines)\n</content>`
  const out = compactReadOutput(raw, dir)
  assert.equal(out, `<path>a.txt</path>\n<content>\n1: one\n</content>`)
  const d = `<path>${dir}</path>\n<type>directory</type>\n<entries>`
  assert.equal(compactReadOutput(d, dir), d)
})

test("2.x read header is made relative", () => {
  assert.equal(compactReadOutput(`Read file ${file}, lines 1-4\n1: one`, dir), "Read file a.txt, lines 1-4\n1: one")
})

test("paths outside the project stay absolute", () => {
  const other = path.join(os.tmpdir(), "elsewhere.txt")
  assert.equal(compactReadOutput(`Read file ${other}, lines 1-1\n1: x`, dir), `Read file ${other}, lines 1-1\n1: x`)
})

test("line range expands for filePath (1.x) and path (2.x)", () => {
  assert.equal(expandLineRange({ filePath: file, oldString: "2-3" }, dir).oldString, "two\nthree")
  assert.equal(expandLineRange({ path: "a.txt", oldString: "4" }, dir).oldString, "four")
  assert.equal(expandLineRange({ path: file, oldString: "two" }, dir).oldString, "two")
  assert.equal(expandLineRange({ path: file, oldString: "9-12" }, dir).oldString, "9-12")
})

test("1.x hooks work end to end", async () => {
  const hooks: any = await plugin.server({ directory: dir })
  const def = { description: "long" }
  await hooks["tool.definition"]({ toolID: "bash" }, def)
  assert.equal(def.description, SLIM.bash)
  const before = { args: { filePath: file, oldString: "1-2", newString: "x" } }
  await hooks["tool.execute.before"]({ tool: "edit" }, before)
  assert.equal(before.args.oldString, "one\ntwo")
  const after = { output: "Edit applied successfully." }
  await hooks["tool.execute.after"]({ tool: "edit" }, after)
  assert.equal(after.output, "OK")
})

test("2.x hooks work end to end with a fake context", async () => {
  const hooks: Record<string, Function> = {}
  const ctx = {
    location: { directory: dir },
    session: { hook: async (name: string, fn: Function) => { hooks["session." + name] = fn } },
    tool: { hook: async (name: string, fn: Function) => { hooks["tool." + name] = fn } },
  }
  await plugin.setup(ctx)

  const context = { tools: { shell: { description: "long" }, read: { description: "long" }, custom: { description: "keep" } } }
  await hooks["session.context"](context)
  assert.equal(context.tools.shell.description, SLIM.shell)
  assert.equal(context.tools.custom.description, "keep")

  const before: any = { tool: "edit", input: { path: file, oldString: "3-4", newString: "x" } }
  await hooks["tool.execute.before"](before)
  assert.equal(before.input.oldString, "three\nfour")

  const edit: any = { tool: "edit", status: "completed", result: { content: `Edited ${file} (1 replacement)` } }
  await hooks["tool.execute.after"](edit)
  assert.equal(edit.result.content, "OK")

  const read: any = { tool: "read", status: "completed", result: { content: [{ type: "text", text: `Read file ${file}, lines 1-1\n1: one` }] } }
  await hooks["tool.execute.after"](read)
  assert.equal(read.result.content[0].text, "Read file a.txt, lines 1-1\n1: one")

  const failed: any = { tool: "edit", status: "error", error: { message: "x" } }
  await hooks["tool.execute.after"](failed)
  assert.equal(failed.error.message, "x")
})
