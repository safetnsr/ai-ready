import type { AnalysisResult, FileScore } from "./analyzer.js";

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function colorScore(score: number): string {
  if (score >= 70) return `${GREEN}${score}${RESET}`;
  if (score >= 40) return `${YELLOW}${score}${RESET}`;
  return `${RED}${score}${RESET}`;
}

function padRight(str: string, len: number): string {
  return str.length >= len ? str : str + " ".repeat(len - str.length);
}

export function formatTable(result: AnalysisResult, options?: { explain?: boolean }): string {
  const files = result.files;

  const lines: string[] = [];
  lines.push(`${BOLD}ai-ready${RESET} — codebase scan complete\n`);

  // Header
  const header = `${DIM}${padRight("FILE", 40)} ${padRight("SCORE", 8)} ${padRight("TOP ISSUE", 24)} FIX${RESET}`;
  lines.push(header);

  for (const file of files) {
    const topIssue = file.issues[0] || "✓ AI-ready";
    const fix = file.issues[1] || "";
    const scorePadded = colorScore(file.score);
    // We need to account for ANSI codes in padding
    const scoreDisplay = `${scorePadded}${" ".repeat(Math.max(0, 8 - String(file.score).length))}`;
    lines.push(
      `${padRight(file.path, 40)} ${scoreDisplay}${padRight(topIssue, 24)} ${fix}`
    );

    if (options?.explain && file.signals) {
      const s = file.signals;
      lines.push(
        `${DIM}  ├─ function_length: ${s.functionLength}  coupling: ${s.coupling}  tests: ${s.testCoverage}  comments: ${s.commentDensity}  size: ${s.fileSize}${RESET}`
      );
    }
  }

  lines.push("");

  // Overall
  const overallColor = result.overall >= 70 ? GREEN : result.overall >= 40 ? YELLOW : RED;
  const emoji = result.overall >= 70 ? "✓" : result.overall >= 40 ? "⚠️" : "✗";
  lines.push(
    `${BOLD}overall: ${overallColor}${result.overall}/100${RESET} ${emoji}${result.overall >= 70 ? " AI-ready" : result.overall >= 40 ? "  some modules need work before AI sessions" : "  significant refactoring needed"}`
  );

  for (const rec of result.recommendations) {
    lines.push(`→ ${rec}`);
  }

  return lines.join("\n");
}

export function formatJSON(result: AnalysisResult): string {
  return JSON.stringify(
    {
      files: result.files.map((f) => ({
        path: f.path,
        score: f.score,
        issues: f.issues,
        ...(f.signals ? { signals: f.signals } : {}),
      })),
      overall: result.overall,
      recommendations: result.recommendations,
    },
    null,
    2
  );
}
