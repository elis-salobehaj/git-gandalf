import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { z } from "zod";
import { config } from "../config";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Tool definitions in Anthropic tool_use format.
// Passed directly to `messages.create({ tools: TOOL_DEFINITIONS })`.
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [
  {
    name: "read_file",
    description:
      "Read a file's contents from the cloned repository. Returns up to 500 lines with 1-based line numbers prepended. The path must be relative to the repository root.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Path to the file relative to the repository root (e.g. 'src/api/router.ts').",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "search_codebase",
    description:
      "Search the repository using ripgrep. Returns matching file paths, 1-based line numbers, and the matching line text. Capped at 30 results across all files.",
    input_schema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query (plain text or regex pattern passed to ripgrep).",
        },
        file_glob: {
          type: "string",
          description:
            "Optional glob pattern to restrict the search to specific file types (e.g. '*.ts', '**/*.json'). Defaults to all files.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_directory_structure",
    description:
      "Get a tree-style directory listing of the repository (max depth 3). Common build and tooling directories (.git, node_modules, dist, etc.) are omitted automatically.",
    input_schema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Optional sub-directory path relative to the repository root. Defaults to the repository root.",
        },
      },
      required: [],
    },
  },
] as const;

// ---------------------------------------------------------------------------
// Path traversal guard — shared by readFile and getDirectoryStructure
// ---------------------------------------------------------------------------

function assertInsideRepo(repoPath: string, targetPath: string): void {
  const sandboxed = resolve(repoPath);
  const resolved = resolve(repoPath, targetPath);
  if (resolved !== sandboxed && !resolved.startsWith(sandboxed + sep)) {
    throw new Error("Path traversal attempt blocked");
  }
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

/**
 * Read `filePath` (relative to `repoPath`), returning up to 500 lines with
 * 1-based line numbers prepended to each line.
 *
 * Security: `filePath` is resolved against `repoPath` and the result is
 * checked to remain inside the sandbox before any I/O is performed.
 */
export async function readFile(repoPath: string, filePath: string): Promise<string> {
  assertInsideRepo(repoPath, filePath);
  const resolved = resolve(repoPath, filePath);
  const content = await Bun.file(resolved).text();
  return content
    .split("\n")
    .slice(0, 500)
    .map((line, i) => `${i + 1}: ${line}`)
    .join("\n");
}

/**
 * Search `repoPath` using ripgrep.  Returns up to 30 results across all files,
 * each with the relative file path, 1-based line number, and matching line text.
 *
 * When ripgrep is not installed, or there are no matches, returns `[]`.
 */
export async function searchCodebase(repoPath: string, query: string, fileGlob = "*"): Promise<SearchResult[]> {
  const proc = Bun.spawn(["rg", "--json", "-g", fileGlob, query, "."], {
    cwd: repoPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  await proc.exited;
  const output = await new Response(proc.stdout).text();
  return parseRipgrepJson(output, config.MAX_SEARCH_RESULTS);
}

// Zod schema for a single ripgrep NDJSON match line.
// We only need the `match` type; other types (begin, end, summary) are skipped.
const rgMatchSchema = z.object({
  type: z.literal("match"),
  data: z.object({
    path: z.object({ text: z.string() }),
    line_number: z.number(),
    lines: z.object({ text: z.string() }),
  }),
});

function parseRipgrepJson(output: string, limit: number): SearchResult[] {
  const results: SearchResult[] = [];

  for (const raw of output.split("\n")) {
    if (results.length >= limit) break;
    if (!raw.trim()) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // skip malformed NDJSON lines
    }

    const match = rgMatchSchema.safeParse(parsed);
    if (!match.success) continue;

    const { data } = match.data;
    results.push({
      file: data.path.text,
      line: data.line_number,
      text: data.lines.text.trimEnd(),
    });
  }

  return results;
}

// Directories that getDirectoryStructure skips at every depth level.
const IGNORED_DIRS = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  ".nyc_output",
  ".cache",
  "vendor",
  "target",
]);

/**
 * Return a tree-style directory listing for `subPath` inside `repoPath`.
 * Maximum recursion depth is 3. Common tooling directories are omitted.
 *
 * Security: `subPath` is resolved against `repoPath` and checked before any
 * I/O is performed.
 */
export async function getDirectoryStructure(repoPath: string, subPath = "."): Promise<string> {
  assertInsideRepo(repoPath, subPath);
  const resolved = resolve(repoPath, subPath);
  return buildTree(resolved, 0);
}

async function buildTree(dirPath: string, depth: number): Promise<string> {
  if (depth >= 3) return "";

  let entries: Dirent<string>[];
  try {
    entries = (await readdir(dirPath, { withFileTypes: true })) as Dirent<string>[];
  } catch {
    return "";
  }

  // Directories first, then files; both groups sorted alphabetically.
  entries.sort((a, b) => {
    const aDir = a.isDirectory() ? 0 : 1;
    const bDir = b.isDirectory() ? 0 : 1;
    return aDir !== bDir ? aDir - bDir : a.name.localeCompare(b.name);
  });

  const pad = "  ".repeat(depth);
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue;
      lines.push(`${pad}${entry.name}/`);
      const sub = await buildTree(join(dirPath, entry.name), depth + 1);
      if (sub) lines.push(sub);
    } else {
      lines.push(`${pad}${entry.name}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Zod input schemas for executeTool — validates LLM-supplied arguments before
// passing them to tool implementations.
// ---------------------------------------------------------------------------

const readFileInputSchema = z.object({ path: z.string() });
const searchCodebaseInputSchema = z.object({ query: z.string(), file_glob: z.string().optional() });
const getDirectoryStructureInputSchema = z.object({ path: z.string().optional() });

/**
 * Dispatch a `tool_use` block from an LLM response to the corresponding
 * implementation.  `toolInput` is Zod-validated before the implementation is
 * called so that malformed LLM arguments produce a clear schema error rather
 * than a silent type failure.
 */
export async function executeTool(
  repoPath: string,
  toolName: string,
  toolInput: Record<string, unknown>,
): Promise<string> {
  switch (toolName) {
    case "read_file": {
      const input = readFileInputSchema.parse(toolInput);
      return readFile(repoPath, input.path);
    }
    case "search_codebase": {
      const input = searchCodebaseInputSchema.parse(toolInput);
      const results = await searchCodebase(repoPath, input.query, input.file_glob);
      return JSON.stringify(results, null, 2);
    }
    case "get_directory_structure": {
      const input = getDirectoryStructureInputSchema.parse(toolInput);
      return getDirectoryStructure(repoPath, input.path ?? ".");
    }
    default:
      return `Unknown tool: ${toolName}`;
  }
}
