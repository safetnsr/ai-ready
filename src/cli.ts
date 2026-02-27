#!/usr/bin/env node

import { resolve } from "node:path";
import { scanDirectory } from "./core/scanner.js";
import { analyzeDirectory } from "./core/analyzer.js";
import { formatTable, formatJSON } from "./core/reporter.js";

interface CliOptions {
  dir: string;
  json: boolean;
  top?: number;
  minScore?: number;
  ci: boolean;
  explain: boolean;
  ext?: string[];
  help: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = {
    dir: ".",
    json: false,
    ci: false,
    explain: false,
    help: false,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--ci") {
      opts.ci = true;
    } else if (arg === "--explain") {
      opts.explain = true;
    } else if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--top" && i + 1 < args.length) {
      opts.top = parseInt(args[++i], 10);
    } else if (arg === "--min-score" && i + 1 < args.length) {
      opts.minScore = parseInt(args[++i], 10);
    } else if (arg === "--ext" && i + 1 < args.length) {
      opts.ext = args[++i].split(",");
    } else if (!arg.startsWith("-")) {
      opts.dir = arg;
    }
    i++;
  }

  return opts;
}

const HELP = `
ai-ready — pre-session codebase AI-readiness scorer

Usage: ai-ready [dir] [options]

Options:
  --json          Output machine-readable JSON
  --top N         Show only worst N files
  --min-score N   Only show files below score N
  --ci            Exit 1 if overall < 60, exit 0 if ≥ 60
  --explain       Show per-signal breakdown per file
  --ext LIST      Comma-separated extensions (default: .ts,.js,.tsx,.jsx)
  -h, --help      Show this help

Examples:
  ai-ready                    # scan current directory
  ai-ready ./src              # scan specific directory
  ai-ready --json             # JSON output for CI/agents
  ai-ready --ci               # gate CI on readiness score
  ai-ready --top 5 --explain  # worst 5 files with signal breakdown
`;

export function main(args?: string[]): { exitCode: number; output: string } {
  const cliArgs = args ?? process.argv.slice(2);
  const opts = parseArgs(cliArgs);

  if (opts.help) {
    return { exitCode: 0, output: HELP };
  }

  const dir = resolve(opts.dir);
  const files = scanDirectory(dir, opts.ext ? { extensions: opts.ext } : undefined);

  if (files.length === 0) {
    const msg = opts.json
      ? JSON.stringify({ files: [], overall: 100, recommendations: [] }, null, 2)
      : "ai-ready — no source files found";
    return { exitCode: opts.ci ? 0 : 0, output: msg };
  }

  let result = analyzeDirectory(files, dir);

  // Apply filters to the result
  if (opts.minScore !== undefined) {
    result = {
      ...result,
      files: result.files.filter((f) => f.score < opts.minScore!),
    };
  }
  if (opts.top !== undefined) {
    result = {
      ...result,
      files: result.files.slice(0, opts.top),
    };
  }

  let output: string;
  if (opts.json) {
    output = formatJSON(result);
  } else {
    output = formatTable(result, {
      explain: opts.explain,
    });
  }

  const exitCode = opts.ci ? (result.overall < 60 ? 1 : 0) : 0;

  return { exitCode, output };
}

// Run if executed directly
const isDirectRun = process.argv[1] &&
  (process.argv[1].endsWith("/ai-ready") ||
   process.argv[1].endsWith("/cli.js") ||
   process.argv[1].endsWith("/dist/cli.js"));

if (isDirectRun) {
  const { exitCode, output } = main();
  console.log(output);
  process.exit(exitCode);
}
