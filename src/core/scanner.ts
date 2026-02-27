import { readdirSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";

const DEFAULT_EXTENSIONS = new Set([".ts", ".js", ".tsx", ".jsx"]);
const IGNORE_DIRS = new Set(["node_modules", "dist", ".git", "coverage", ".next", "build"]);

export interface ScanOptions {
  extensions?: string[];
}

export function scanDirectory(dir: string, options?: ScanOptions): string[] {
  const extensions = options?.extensions
    ? new Set(options.extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)))
    : DEFAULT_EXTENSIONS;

  const files: string[] = [];

  function walk(current: string): void {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry)) continue;

      const fullPath = join(current, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && extensions.has(extname(entry))) {
        files.push(relative(dir, fullPath));
      }
    }
  }

  walk(dir);
  return files.sort();
}
