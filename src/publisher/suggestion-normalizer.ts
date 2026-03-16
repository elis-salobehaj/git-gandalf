import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Finding } from "../agents/state";

function splitContentLines(content: string): string[] {
  if (content.length === 0) return [];

  const normalized = content.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((line, index) => line === right[index]);
}

function stripMatchingPrefix(candidate: string[], beforeRange: string[]): string[] {
  for (let size = Math.min(candidate.length, beforeRange.length); size > 0; size--) {
    if (arraysEqual(candidate.slice(0, size), beforeRange.slice(beforeRange.length - size))) {
      return candidate.slice(size);
    }
  }

  return candidate;
}

function stripMatchingSuffix(candidate: string[], afterRange: string[]): string[] {
  for (let size = Math.min(candidate.length, afterRange.length); size > 0; size--) {
    if (arraysEqual(candidate.slice(candidate.length - size), afterRange.slice(0, size))) {
      return candidate.slice(0, candidate.length - size);
    }
  }

  return candidate;
}

export function normalizeSuggestionCodeForRange(
  fileContent: string,
  lineStart: number,
  lineEnd: number,
  suggestedFixCode: string | undefined,
): string | undefined {
  if (suggestedFixCode === undefined) return undefined;

  const fileLines = splitContentLines(fileContent);
  const beforeRange = fileLines.slice(0, lineStart - 1);
  const targetRange = fileLines.slice(lineStart - 1, lineEnd);
  const afterRange = fileLines.slice(lineEnd);

  let candidate = splitContentLines(suggestedFixCode);
  candidate = stripMatchingPrefix(candidate, beforeRange);
  candidate = stripMatchingSuffix(candidate, afterRange);

  if (arraysEqual(candidate, targetRange)) {
    return undefined;
  }

  return candidate.join("\n");
}

function resolveFindingPath(repoPath: string, findingFile: string): string | null {
  const absoluteRepoPath = resolve(repoPath);
  const resolvedPath = resolve(repoPath, findingFile);

  if (resolvedPath === absoluteRepoPath || resolvedPath.startsWith(`${absoluteRepoPath}${sep}`)) {
    return resolvedPath;
  }

  return null;
}

export async function normalizeFindingsForPublication(repoPath: string, findings: Finding[]): Promise<Finding[]> {
  return Promise.all(
    findings.map(async (finding) => {
      if (finding.suggestedFixCode === undefined) {
        return finding;
      }

      const resolvedPath = resolveFindingPath(repoPath, finding.file);
      if (!resolvedPath) {
        return { ...finding, suggestedFixCode: undefined };
      }

      try {
        const fileContent = await readFile(resolvedPath, "utf8");
        const normalizedCode = normalizeSuggestionCodeForRange(
          fileContent,
          finding.lineStart,
          finding.lineEnd,
          finding.suggestedFixCode,
        );

        return { ...finding, suggestedFixCode: normalizedCode };
      } catch {
        return { ...finding, suggestedFixCode: undefined };
      }
    }),
  );
}
