import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../src/config";
import type { SearchResult } from "../src/context/tools";
import { executeTool, getDirectoryStructure, readFile, searchCodebase } from "../src/context/tools";

// ---------------------------------------------------------------------------
// Temp fixture directory: created fresh in beforeAll, removed in afterAll.
// We use import.meta.dir so the path is stable regardless of cwd.
// ---------------------------------------------------------------------------

const SANDBOX = join(import.meta.dir, "__temp_tools_sandbox__");

// Check ripgrep availability synchronously at module load so we can conditionally
// skip rg-dependent tests without an async beforeAll dependency.
const rgAvailable = Bun.spawnSync(["which", "rg"]).exitCode === 0;

beforeAll(async () => {
  await mkdir(join(SANDBOX, "src"), { recursive: true });
  await mkdir(join(SANDBOX, "docs"), { recursive: true });

  await writeFile(
    join(SANDBOX, "src/example.ts"),
    "const greeting = 'hello world';\nconsole.log(greeting);\nexport {};\n",
  );

  await writeFile(
    join(SANDBOX, "src/utils.ts"),
    "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
  );

  await writeFile(join(SANDBOX, "docs/README.md"), "# Test Repo\n\nThis is a test.\n");
});

afterAll(async () => {
  await rm(SANDBOX, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------

describe("readFile", () => {
  it("returns file content with 1-based line numbers", async () => {
    const result = await readFile(SANDBOX, "src/example.ts");
    expect(result).toContain("1: const greeting = 'hello world';");
    expect(result).toContain("2: console.log(greeting);");
    expect(result).toContain("3: export {};");
  });

  it("reads files in sub-directories", async () => {
    const result = await readFile(SANDBOX, "docs/README.md");
    expect(result).toContain("1: # Test Repo");
    expect(result).toContain("3: This is a test.");
  });

  it("blocks relative path traversal attempts (../)", async () => {
    await expect(readFile(SANDBOX, "../../etc/passwd")).rejects.toThrow("Path traversal attempt blocked");
  });

  it("blocks absolute path injection attempts", async () => {
    await expect(readFile(SANDBOX, "/etc/passwd")).rejects.toThrow("Path traversal attempt blocked");
  });

  it("throws when the requested file does not exist", async () => {
    await expect(readFile(SANDBOX, "src/nonexistent.ts")).rejects.toThrow();
  });

  it("limits output to 500 lines", async () => {
    // Write a file with 600 lines
    const content = `${Array.from({ length: 600 }, (_, i) => `line ${i + 1}`).join("\n")}\n`;
    await writeFile(join(SANDBOX, "src/bigfile.ts"), content);

    const result = await readFile(SANDBOX, "src/bigfile.ts");
    const lines = result.split("\n");
    // 500 numbered lines (line 500 is the last numbered entry)
    expect(lines.length).toBe(500);
    expect(lines[0]).toStartWith("1: ");
    expect(lines[499]).toStartWith("500: ");

    await rm(join(SANDBOX, "src/bigfile.ts"));
  });
});

// ---------------------------------------------------------------------------
// getDirectoryStructure
// ---------------------------------------------------------------------------

describe("getDirectoryStructure", () => {
  it("lists repo root with directories before files", async () => {
    const result = await getDirectoryStructure(SANDBOX);
    const lines = result.split("\n").filter(Boolean);
    // docs/ and src/ must appear as directory entries
    expect(lines).toContain("docs/");
    expect(lines).toContain("src/");
    // Directories should come before any top-level file entries
    const docsIdx = lines.indexOf("docs/");
    const srcIdx = lines.indexOf("src/");
    expect(docsIdx).toBeGreaterThanOrEqual(0);
    expect(srcIdx).toBeGreaterThanOrEqual(0);
  });

  it("includes files nested inside subdirectories", async () => {
    const result = await getDirectoryStructure(SANDBOX);
    expect(result).toContain("example.ts");
    expect(result).toContain("utils.ts");
    expect(result).toContain("README.md");
  });

  it("supports an explicit sub-path argument", async () => {
    const result = await getDirectoryStructure(SANDBOX, "src");
    expect(result).toContain("example.ts");
    expect(result).toContain("utils.ts");
    // Items from other directories must not appear
    expect(result).not.toContain("README.md");
    expect(result).not.toContain("docs/");
  });

  it("omits ignored directories (node_modules, .git, dist, etc.)", async () => {
    await mkdir(join(SANDBOX, "node_modules"), { recursive: true });
    await mkdir(join(SANDBOX, ".git"), { recursive: true });
    await mkdir(join(SANDBOX, "dist"), { recursive: true });

    const result = await getDirectoryStructure(SANDBOX);
    expect(result).not.toContain("node_modules");
    expect(result).not.toContain(".git");
    expect(result).not.toContain("dist");

    await rm(join(SANDBOX, "node_modules"), { recursive: true });
    await rm(join(SANDBOX, ".git"), { recursive: true });
    await rm(join(SANDBOX, "dist"), { recursive: true });
  });

  it("respects the depth-3 limit", async () => {
    // Create a 4-level deep structure
    await mkdir(join(SANDBOX, "deep/a/b/c"), { recursive: true });
    await writeFile(join(SANDBOX, "deep/a/b/c/hidden.ts"), "// too deep\n");

    const result = await getDirectoryStructure(SANDBOX);
    // Level 1: deep/, level 2: a/, level 3: b/ — c/ is at depth 3 so it won't recurse
    expect(result).toContain("deep/");
    expect(result).toContain("b/");
    expect(result).not.toContain("hidden.ts");

    await rm(join(SANDBOX, "deep"), { recursive: true });
  });

  it("blocks relative path traversal attempts", async () => {
    await expect(getDirectoryStructure(SANDBOX, "../../")).rejects.toThrow("Path traversal attempt blocked");
  });

  it("blocks absolute path injection attempts", async () => {
    await expect(getDirectoryStructure(SANDBOX, "/")).rejects.toThrow("Path traversal attempt blocked");
  });
});

// ---------------------------------------------------------------------------
// searchCodebase (requires ripgrep — skipped when rg is not installed)
// ---------------------------------------------------------------------------

describe("searchCodebase", () => {
  it.skipIf(!rgAvailable)("returns matching results with file, line, and text fields", async () => {
    const results = await searchCodebase(SANDBOX, "greeting");
    expect(results.length).toBeGreaterThan(0);
    const r = results[0];
    expect(r.file).toContain("example.ts");
    expect(typeof r.line).toBe("number");
    expect(r.line).toBeGreaterThan(0);
    expect(r.text).toContain("greeting");
  });

  it.skipIf(!rgAvailable)("returns an empty array when there are no matches", async () => {
    const results = await searchCodebase(SANDBOX, "zzz_definitely_not_present_xyz_42");
    expect(results).toEqual([]);
  });

  it.skipIf(!rgAvailable)("respects the file_glob parameter", async () => {
    const results = await searchCodebase(SANDBOX, "test", "*.md");
    // Every returned match must be from a markdown file
    for (const r of results) {
      expect(r.file.endsWith(".md")).toBe(true);
    }
  });

  it.skipIf(!rgAvailable)("caps total results at MAX_SEARCH_RESULTS even with more matches", async () => {
    // Write a file with config.MAX_SEARCH_RESULTS + 50 lines to guarantee we exceed the cap.
    const overLimit = config.MAX_SEARCH_RESULTS + 50;
    const manyMatches = Array.from({ length: overLimit }, (_, i) => `const x${i} = 'needleXYZ';\n`).join("");
    await writeFile(join(SANDBOX, "src/many.ts"), manyMatches);

    const results = await searchCodebase(SANDBOX, "needleXYZ");
    expect(results.length).toBeLessThanOrEqual(config.MAX_SEARCH_RESULTS);

    await rm(join(SANDBOX, "src/many.ts"));
  });
});

// ---------------------------------------------------------------------------
// executeTool — dispatcher with Zod validation
// ---------------------------------------------------------------------------

describe("executeTool", () => {
  it("dispatches read_file and returns formatted content", async () => {
    const result = await executeTool(SANDBOX, "read_file", { path: "src/example.ts" });
    expect(result).toContain("1: const greeting");
  });

  it("dispatches get_directory_structure with no path and returns tree", async () => {
    const result = await executeTool(SANDBOX, "get_directory_structure", {});
    expect(result).toContain("src/");
    expect(result).toContain("docs/");
  });

  it("dispatches get_directory_structure with an explicit path", async () => {
    const result = await executeTool(SANDBOX, "get_directory_structure", { path: "src" });
    expect(result).toContain("example.ts");
    expect(result).not.toContain("README.md");
  });

  it.skipIf(!rgAvailable)("dispatches search_codebase and returns JSON array", async () => {
    const result = await executeTool(SANDBOX, "search_codebase", { query: "greeting" });
    const parsed = JSON.parse(result) as SearchResult[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(typeof parsed[0].file).toBe("string");
    expect(typeof parsed[0].line).toBe("number");
  });

  it("returns an error message for an unknown tool name", async () => {
    const result = await executeTool(SANDBOX, "unknown_tool", {});
    expect(result).toContain("Unknown tool: unknown_tool");
  });

  it("throws a Zod validation error when tool input is invalid", async () => {
    // read_file requires 'path' to be a string; passing a number should fail
    await expect(executeTool(SANDBOX, "read_file", { path: 42 })).rejects.toThrow();
  });

  it("throws a Zod validation error when required tool input is missing", async () => {
    // search_codebase requires 'query'
    await expect(executeTool(SANDBOX, "search_codebase", {})).rejects.toThrow();
  });
});
