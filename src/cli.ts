#!/usr/bin/env node

import * as path from 'node:path';
import * as fs from 'node:fs';
import { collectFiles, analyzeFiles } from './analyzer';
import { reportTerminal, reportJSON } from './reporter';

const VERSION = '1.0.0';
const HELP = `
ai-ready — pre-session agent briefing for JS/TS codebases

usage:
  npx @safetnsr/ai-ready [path] [options]

  path: file or directory to analyze (default: current directory)

options:
  --json          machine-readable output
  --top <n>       show only top N riskiest files (default: all)
  --context       alias for default behavior (explicit flag)
  --version, -v   show version
  --help, -h      show help

examples:
  npx @safetnsr/ai-ready                    scan current directory
  npx @safetnsr/ai-ready src/auth/          brief me on auth module
  npx @safetnsr/ai-ready src/auth/index.ts  brief me on one file
  npx @safetnsr/ai-ready --json             machine-readable for agent consumption
  npx @safetnsr/ai-ready --top 5            show 5 riskiest files
`;

async function main() {
  const args = process.argv.slice(2);

  // flags
  if (args.includes('--version') || args.includes('-v')) {
    console.log(VERSION);
    process.exit(0);
  }
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    process.exit(0);
  }

  const jsonMode = args.includes('--json');
  let top: number | null = null;
  const topIdx = args.indexOf('--top');
  if (topIdx !== -1 && args[topIdx + 1]) {
    top = parseInt(args[topIdx + 1], 10);
  }

  // target path: first arg that doesn't start with --
  let targetPath = process.cwd();
  for (const arg of args) {
    if (!arg.startsWith('--') && !arg.startsWith('-')) {
      // skip if it's the number after --top
      if (topIdx !== -1 && args[topIdx + 1] === arg) continue;
      targetPath = path.resolve(arg);
      break;
    }
  }

  if (!fs.existsSync(targetPath)) {
    console.error(`error: path not found: ${targetPath}`);
    process.exit(1);
  }

  const projectRoot = fs.statSync(targetPath).isFile()
    ? path.dirname(targetPath)
    : targetPath;

  // for circular dep detection, find the actual project root (has package.json)
  let madgeRoot = projectRoot;
  let current = projectRoot;
  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      madgeRoot = current;
      break;
    }
    current = path.dirname(current);
  }

  const files = collectFiles(targetPath);

  if (files.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify({ files: [], summary: 'no JS/TS files found.' }, null, 2));
    } else {
      console.log('no JS/TS files found in', targetPath);
    }
    process.exit(0);
  }

  // limit to top 10 for full project scans if no --top specified
  const isFullProjectScan = fs.statSync(targetPath).isDirectory() && targetPath === process.cwd();
  const effectiveTop = top ?? (isFullProjectScan && files.length > 10 ? 10 : null);

  const result = await analyzeFiles(files, madgeRoot);

  if (effectiveTop !== null) {
    result.files = result.files.slice(0, effectiveTop);
  }

  if (jsonMode) {
    console.log(reportJSON(result));
  } else {
    console.log(reportTerminal(result));
  }

  const hasHighRisk = result.files.some(f => f.risk_level === 'high');
  process.exit(hasHighRisk ? 1 : 0);
}

main().catch(err => {
  console.error('error:', err.message || err);
  process.exit(1);
});
