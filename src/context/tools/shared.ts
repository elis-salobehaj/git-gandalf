import { resolve, sep } from "node:path";

// ---------------------------------------------------------------------------
// Types shared across all tool implementations
// ---------------------------------------------------------------------------

export interface SearchResult {
  file: string;
  line: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Path traversal guard — used by any tool that accepts a file or directory
// path from the LLM. Resolved path must remain strictly inside repoPath.
// ---------------------------------------------------------------------------

export function assertInsideRepo(repoPath: string, targetPath: string): void {
  const sandboxed = resolve(repoPath);
  const resolved = resolve(repoPath, targetPath);
  if (resolved !== sandboxed && !resolved.startsWith(sandboxed + sep)) {
    throw new Error("Path traversal attempt blocked");
  }
}
