// ---------------------------------------------------------------------------
// Diff hunk parser — converts raw DiffFile.diff strings into structured
// ParsedHunk objects that agents can reason about at the block level.
// ---------------------------------------------------------------------------

import type { DiffFile, ParsedHunk } from "../gitlab-client/types";

/**
 * Parse all diff files into a flat list of structured hunks.
 * Each hunk covers one contiguous @@ block within one file.
 * Deleted files are skipped — their hunks cannot be anchored to new-file lines.
 */
export function parseDiffHunks(diffFiles: DiffFile[]): ParsedHunk[] {
  const result: ParsedHunk[] = [];

  for (const file of diffFiles) {
    if (file.deletedFile) continue;

    const lines = file.diff.split("\n");
    let hunkIndex = 0;
    let currentHunk: ParsedHunk | null = null;
    let currentNewLine = 0;

    for (const line of lines) {
      if (line.startsWith("@@")) {
        if (currentHunk) {
          currentHunk.newLineEnd = Math.max(currentNewLine - 1, currentHunk.newLineStart);
          result.push(currentHunk);
        }

        hunkIndex++;
        const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        currentNewLine = match ? Number(match[1]) : 1;

        currentHunk = {
          file: file.newPath,
          hunkIndex,
          header: line,
          newLineStart: currentNewLine,
          newLineEnd: currentNewLine,
          addedLines: [],
          removedLines: [],
          contextLines: [],
        };
        continue;
      }

      if (!currentHunk) continue;
      if (line.startsWith("+++") || line.startsWith("---") || line.length === 0) continue;

      if (line.startsWith("+")) {
        currentHunk.addedLines.push({ lineNumber: currentNewLine, content: line.slice(1) });
        currentNewLine++;
        continue;
      }

      if (line.startsWith("-")) {
        currentHunk.removedLines.push({ content: line.slice(1) });
        continue;
      }

      // Context line
      currentHunk.contextLines.push({ lineNumber: currentNewLine, content: line.slice(1) });
      currentNewLine++;
    }

    if (currentHunk) {
      currentHunk.newLineEnd = Math.max(currentNewLine - 1, currentHunk.newLineStart);
      result.push(currentHunk);
    }
  }

  return result;
}
