import { describe, it } from "node:test";
import * as assert from "node:assert";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { scanDirectory } from "../core/scanner.js";

const TMP = join(process.cwd(), ".test-tmp-scanner");

function setup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
  mkdirSync(TMP, { recursive: true });
}

function cleanup() {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
}

describe("scanner", () => {
  // Test 16: finds .ts and .js files, ignores node_modules and dist
  it("finds .ts and .js files, ignores node_modules and dist", () => {
    setup();
    mkdirSync(join(TMP, "src"), { recursive: true });
    mkdirSync(join(TMP, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(TMP, "dist"), { recursive: true });

    writeFileSync(join(TMP, "src", "app.ts"), "export const x = 1;");
    writeFileSync(join(TMP, "src", "utils.js"), "const y = 2;");
    writeFileSync(join(TMP, "node_modules", "pkg", "index.js"), "module.exports = {};");
    writeFileSync(join(TMP, "dist", "app.js"), "const z = 3;");
    writeFileSync(join(TMP, "readme.md"), "# readme");

    const files = scanDirectory(TMP);
    assert.ok(files.includes(join("src", "app.ts")));
    assert.ok(files.includes(join("src", "utils.js")));
    assert.ok(!files.some((f) => f.includes("node_modules")));
    assert.ok(!files.some((f) => f.includes("dist")));
    assert.ok(!files.some((f) => f.includes("readme.md")));
    cleanup();
  });

  // Test 17: handles empty directory gracefully
  it("handles empty directory gracefully", () => {
    setup();
    const files = scanDirectory(TMP);
    assert.ok(Array.isArray(files));
    assert.strictEqual(files.length, 0);
    cleanup();
  });
});
