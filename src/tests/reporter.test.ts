import { describe, it } from "node:test";
import * as assert from "node:assert";
import { formatJSON, formatTable } from "../core/reporter.js";
import type { AnalysisResult } from "../core/analyzer.js";

const mockResult: AnalysisResult = {
  files: [
    {
      path: "src/auth/index.ts",
      score: 12,
      issues: ["function too long", "split into smaller functions"],
      signals: { functionLength: 0, coupling: 0, testCoverage: 0, commentDensity: 10, fileSize: 40 },
    },
    {
      path: "src/utils/helpers.ts",
      score: 87,
      issues: [],
      signals: { functionLength: 100, coupling: 100, testCoverage: 100, commentDensity: 70, fileSize: 100 },
    },
  ],
  overall: 50,
  recommendations: ["split src/auth/index.ts into smaller files first (biggest win)"],
};

describe("reporter", () => {
  // Test 9: --json outputs valid JSON
  it("formatJSON outputs valid JSON", () => {
    const output = formatJSON(mockResult);
    const parsed = JSON.parse(output);
    assert.ok(parsed);
    assert.ok(typeof parsed === "object");
  });

  // Test 10: --json shape has {files, overall, recommendations}
  it("formatJSON has correct shape", () => {
    const output = formatJSON(mockResult);
    const parsed = JSON.parse(output);
    assert.ok(Array.isArray(parsed.files));
    assert.ok(typeof parsed.overall === "number");
    assert.ok(Array.isArray(parsed.recommendations));
    assert.strictEqual(parsed.files.length, 2);
    assert.ok(parsed.files[0].path);
    assert.ok(typeof parsed.files[0].score === "number");
    assert.ok(Array.isArray(parsed.files[0].issues));
  });

  // Test 11: color output includes file name
  it("formatTable includes file name", () => {
    const output = formatTable(mockResult);
    assert.ok(output.includes("src/auth/index.ts"));
    assert.ok(output.includes("src/utils/helpers.ts"));
  });
});
