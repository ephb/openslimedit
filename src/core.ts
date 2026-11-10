// Version independent logic shared by the OpenCode 1.x and 2.x entry points.
import * as fs from "fs"
import * as path from "path"

const LINE_RANGE_RE = /^(\d+)(?:\s*-\s*(\d+))?$/

// Short tool descriptions. Covers 1.x names (bash, apply_patch, fetch, list)
// and 2.x names (shell, patch, webfetch).
export const SLIM: Record<string, string> = {
  read: "Read file content (text, images, PDFs) or list a directory. Use offset/limit for large files.",
  edit: "Edit file. oldString can be line range '55-64'.",
  apply_patch: "Apply a patch to files.",
  patch: "Apply a patch to files.",
  write: "Write file.",
  bash: "Run shell command. Prefer read/grep/glob/edit tools for file operations.",
  shell: "Run shell command. Prefer read/grep/glob/edit tools for file operations.",
  glob: "Find files.",
  grep: "Search in files.",
  list: "List directory.",
  fetch: "Fetch URL.",
  webfetch: "Fetch URL.",
}

export function resolvePath(directory: string, filePath: string): string {
  if (path.isAbsolute(filePath)) return path.normalize(filePath)
  return path.resolve(directory, filePath)
}

function relativeTo(directory: string, p: string): string {
  const rel = path.relative(directory, path.normalize(p))
  // Keep absolute paths for files outside the project (other drive or above root).
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return p
  return rel
}

/**
 * Compacts edit tool output.
 * 1.x: "Edit applied successfully." optionally followed by LSP diagnostics.
 *      Only the success sentence is shortened; diagnostics are always kept.
 * 2.x: "Edited <path> (N replacements)" becomes "OK".
 */
export function compactEditOutput(text: string): string {
  const V1 = "Edit applied successfully."
  if (text.startsWith(V1)) return "OK" + text.slice(V1.length)
  if (/^Edited .+ \(\d+ replacements?\)$/.test(text)) return "OK"
  return text
}

/**
 * Compacts read tool output.
 * 1.x: <path>/abs</path>\n<type>file</type>\n<content>...(End of file - total N lines)
 * 2.x: Read file /abs, lines a-b
 */
export function compactReadOutput(text: string, directory: string): string {
  // 1.x format
  if (text.includes("<type>directory</type>")) return text
  const v1 = text.match(/<path>(.+?)<\/path>/)
  if (v1) {
    let out = text.replace(`<path>${v1[1]}</path>`, `<path>${relativeTo(directory, v1[1])}</path>`)
    out = out.replace("<type>file</type>\n", "")
    out = out.replace(/\n\n\(End of file - total \d+ lines\)\n/, "\n")
    return out
  }
  // 2.x format: only the header line changes
  const v2 = text.match(/^Read file (.+?), (lines \d+-\d+|0 lines)/)
  if (v2) {
    return text.replace(`Read file ${v2[1]},`, `Read file ${relativeTo(directory, v2[1])},`)
  }
  return text
}

/**
 * If oldString is a line range like "55-64" (and not literal file text),
 * replaces it with the actual lines. Mutates and returns args.
 * Accepts filePath (1.x) or path (2.x).
 */
export function expandLineRange(args: any, directory: string): any {
  if (!args || typeof args !== "object") return args
  const filePath = args.filePath || args.path
  if (typeof args.oldString !== "string" || !args.oldString || typeof filePath !== "string") return args

  let content: string
  try {
    content = fs.readFileSync(resolvePath(directory, filePath), "utf-8")
  } catch {
    return args
  }
  if (content.includes(args.oldString)) return args

  const match = args.oldString.trim().match(LINE_RANGE_RE)
  if (!match) return args

  const lines = content.split("\n")
  const startLine = parseInt(match[1], 10)
  const endLine = match[2] ? parseInt(match[2], 10) : startLine
  if (startLine >= 1 && endLine <= lines.length && startLine <= endLine) {
    args.oldString = lines.slice(startLine - 1, endLine).join("\n")
  }
  return args
}
