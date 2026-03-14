// ---------------------------------------------------------------------------
// Public API surface for src/context/tools.
//
// All consumers import from this path — `../context/tools` — and get the
// same exports as before the per-tool split. The internal file layout is an
// implementation detail.
// ---------------------------------------------------------------------------

import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import {
  getDirectoryStructure,
  toolDefinition as getDirectoryStructureDef,
  inputSchema as getDirectoryStructureInputSchema,
} from "./get-directory-structure";
import { readFile, toolDefinition as readFileDef, inputSchema as readFileInputSchema } from "./read-file";
import {
  searchCodebase,
  toolDefinition as searchCodebaseDef,
  inputSchema as searchCodebaseInputSchema,
} from "./search-codebase";

export { getDirectoryStructure } from "./get-directory-structure";
export { readFile } from "./read-file";
export { searchCodebase } from "./search-codebase";
export type { SearchResult } from "./shared";

// ---------------------------------------------------------------------------
// Aggregated tool manifest — passed to messages.create({ tools: TOOL_DEFINITIONS })
// Adding a new tool: create a new file, add its toolDefinition here.
// ---------------------------------------------------------------------------

export const TOOL_DEFINITIONS = [readFileDef, searchCodebaseDef, getDirectoryStructureDef] satisfies readonly Tool[];

// ---------------------------------------------------------------------------
// Tool dispatcher — validates LLM-supplied arguments with Zod before calling
// the appropriate implementation. Adding a new tool: add a case here.
// ---------------------------------------------------------------------------

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
