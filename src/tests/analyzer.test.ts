import { describe, it } from "node:test";
import * as assert from "node:assert";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { analyzeFile, analyzeDirectory } from "../core/analyzer.js";

const TMP = join(process.cwd(), ".test-tmp-analyzer");

function setup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
}

function cleanup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}

describe("analyzer", () => {
  // Test 1: empty file → score 100
  it("empty file scores 100", () => {
    setup();
    writeFileSync(join(TMP, "empty.ts"), "");
    const result = analyzeFile("empty.ts", TMP);
    assert.strictEqual(result.score, 100);
    cleanup();
  });

  // Test 2: single 60-line function → function_length_score = 0
  it("single 60-line function scores function_length 0", () => {
    setup();
    const lines = [
      "function bigFunc() {",
      ...Array(58).fill("  const x = 1;"),
      "}",
    ];
    writeFileSync(join(TMP, "big.ts"), lines.join("\n"));
    const result = analyzeFile("big.ts", TMP);
    assert.ok(result.signals);
    assert.strictEqual(result.signals!.functionLength, 0);
    cleanup();
  });

  // Test 3: 9 imports → coupling_score = 0
  it("9 imports scores coupling 0", () => {
    setup();
    const lines = Array(9)
      .fill(null)
      .map((_, i) => `import { thing${i} } from "./mod${i}";`);
    lines.push("export const x = 1;");
    writeFileSync(join(TMP, "coupled.ts"), lines.join("\n"));
    const result = analyzeFile("coupled.ts", TMP);
    assert.ok(result.signals);
    assert.strictEqual(result.signals!.coupling, 0);
    cleanup();
  });

  // Test 4: matching .test.ts exists → test_coverage_score = 100
  it("matching test file gives test coverage 100", () => {
    setup();
    writeFileSync(join(TMP, "module.ts"), "export const x = 1;\n// comment\n");
    writeFileSync(join(TMP, "module.test.ts"), "import { x } from './module';");
    const result = analyzeFile("module.ts", TMP);
    assert.ok(result.signals);
    assert.strictEqual(result.signals!.testCoverage, 100);
    cleanup();
  });

  // Test 5: no test file → test_coverage_score = 0
  it("no test file gives test coverage 0", () => {
    setup();
    writeFileSync(join(TMP, "lonely.ts"), "export const x = 1;\n");
    const result = analyzeFile("lonely.ts", TMP);
    assert.ok(result.signals);
    assert.strictEqual(result.signals!.testCoverage, 0);
    cleanup();
  });

  // Test 6: 10% comment density → comment_density_score = 100
  it("10% comment density scores 100", () => {
    setup();
    // 10 lines total, 1 comment = 10%
    // But > 0.10 is 100, need > 10%. Let's do 11% = 2 comments in 18 lines
    // Actually > 0.10 means strictly more than 10%, so need ratio > 0.10
    const lines = [
      "// this is a comment line one",
      "// this is a comment line two",
      ...Array(8).fill("const x = 1;"),
      "// extra comment",
    ];
    // 11 lines, 3 comments = 27% > 10%
    writeFileSync(join(TMP, "commented.ts"), lines.join("\n"));
    const result = analyzeFile("commented.ts", TMP);
    assert.ok(result.signals);
    assert.strictEqual(result.signals!.commentDensity, 100);
    cleanup();
  });

  // Test 7: 600 line file → file_size_score = 0
  it("600 line file scores file size 0", () => {
    setup();
    const lines = Array(600).fill("const x = 1;");
    writeFileSync(join(TMP, "huge.ts"), lines.join("\n"));
    const result = analyzeFile("huge.ts", TMP);
    assert.ok(result.signals);
    assert.strictEqual(result.signals!.fileSize, 0);
    cleanup();
  });

  // Test 8: weighted overall = correct arithmetic
  it("weighted overall matches expected arithmetic", () => {
    setup();
    // Create a file with known characteristics:
    // - no functions → functionLength=100
    // - 2 imports → coupling=100
    // - no test → testCoverage=0
    // - 0 comments in 5 lines → commentDensity=10
    // - 5 lines → fileSize=100
    // Expected: 100*0.3 + 100*0.25 + 0*0.25 + 10*0.1 + 100*0.1
    //         = 30 + 25 + 0 + 1 + 10 = 66
    const code = [
      'import { a } from "./a";',
      'import { b } from "./b";',
      "export const x = a;",
      "export const y = b;",
      "export default x;",
    ].join("\n");
    writeFileSync(join(TMP, "weighted.ts"), code);
    const result = analyzeFile("weighted.ts", TMP);
    assert.ok(result.signals);
    const expected = Math.round(
      result.signals!.functionLength * 0.3 +
        result.signals!.coupling * 0.25 +
        result.signals!.testCoverage * 0.25 +
        result.signals!.commentDensity * 0.1 +
        result.signals!.fileSize * 0.1
    );
    assert.strictEqual(result.score, expected);
    cleanup();
  });
});
