import { describe, it } from "node:test";
import * as assert from "node:assert";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { main } from "../cli.js";

const TMP = join(process.cwd(), ".test-tmp-cli");

function setup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(join(TMP, "src"), { recursive: true });
}

function cleanup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}

function createTestFiles() {
  // Create several files with varying quality
  for (let i = 0; i < 5; i++) {
    const lines = Array(20 + i * 10).fill("const x = 1;");
    writeFileSync(join(TMP, "src", `file${i}.ts`), lines.join("\n"));
  }
}

describe("cli", () => {
  // Test 12: --top 3 returns only 3 files
  it("--top 3 limits output to 3 files", () => {
    setup();
    createTestFiles();
    const { output } = main(["--json", "--top", "3", TMP]);
    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.files.length, 3);
    cleanup();
  });

  // Test 13: --min-score 50 filters correctly
  it("--min-score filters files", () => {
    setup();
    // Create one bad file and one good file
    const badLines = [
      ...Array(9).fill(null).map((_, i) => `import { x${i} } from "./m${i}";`),
      "function big() {",
      ...Array(58).fill("  const x = 1;"),
      "}",
    ];
    writeFileSync(join(TMP, "src", "bad.ts"), badLines.join("\n"));

    const goodCode = "// good file\nexport const x = 1;\n";
    writeFileSync(join(TMP, "src", "good.ts"), goodCode);
    writeFileSync(join(TMP, "src", "good.test.ts"), "test");

    const { output } = main(["--json", "--min-score", "90", TMP]);
    const parsed = JSON.parse(output);
    // All returned files should have score < 90
    for (const f of parsed.files) {
      assert.ok(f.score < 90, `file ${f.path} has score ${f.score}, expected < 90`);
    }
    cleanup();
  });

  // Test 14: --ci exits 1 if overall < 60
  it("--ci exits 1 if overall < 60", () => {
    setup();
    // Create files that will score low
    const badLines = [
      ...Array(9).fill(null).map((_, i) => `import { x${i} } from "./m${i}";`),
      "function big() {",
      ...Array(100).fill("  const x = 1;"),
      "}",
      ...Array(400).fill("const y = 2;"),
    ];
    writeFileSync(join(TMP, "src", "terrible.ts"), badLines.join("\n"));
    const { exitCode } = main(["--ci", TMP]);
    assert.strictEqual(exitCode, 1);
    cleanup();
  });

  // Test 15: --ci exits 0 if overall ≥ 60
  it("--ci exits 0 if overall >= 60", () => {
    setup();
    // Create a good file with test
    writeFileSync(join(TMP, "src", "clean.ts"), "// well documented\nexport const x = 1;\n");
    writeFileSync(join(TMP, "src", "clean.test.ts"), "test");
    const { exitCode } = main(["--ci", TMP]);
    assert.strictEqual(exitCode, 0);
    cleanup();
  });
});
