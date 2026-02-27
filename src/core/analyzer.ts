import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { parseTypeScript } from "../adapters/typescript.js";
import { parseJavaScript } from "../adapters/javascript.js";

export interface FileScore {
  path: string;
  score: number;
  issues: string[];
  signals?: {
    functionLength: number;
    coupling: number;
    testCoverage: number;
    commentDensity: number;
    fileSize: number;
  };
}

export interface AnalysisResult {
  files: FileScore[];
  overall: number;
  recommendations: string[];
}

function scoreFunctionLength(avgLines: number): number {
  if (avgLines > 50) return 0;
  if (avgLines > 30) return 40;
  if (avgLines > 20) return 70;
  return 100;
}

function scoreCoupling(imports: number): number {
  if (imports > 8) return 0;
  if (imports > 5) return 40;
  if (imports > 3) return 70;
  return 100;
}

function scoreTestCoverage(filePath: string, baseDir: string): number {
  const dir = dirname(join(baseDir, filePath));
  const base = basename(filePath, extname(filePath));
  const ext = extname(filePath);

  // Check various test file patterns
  const patterns = [
    join(dir, `${base}.test${ext}`),
    join(dir, `${base}.spec${ext}`),
    join(dir, "__tests__", `${base}.test${ext}`),
    join(dir, "__tests__", `${base}.spec${ext}`),
  ];

  // Also check in a tests/ or test/ directory at the same level
  const parentDir = dirname(dir);
  const relDir = basename(dir);
  patterns.push(
    join(parentDir, "tests", `${base}.test${ext}`),
    join(parentDir, "test", `${base}.test${ext}`),
    join(parentDir, "tests", relDir, `${base}.test${ext}`),
    join(parentDir, "test", relDir, `${base}.test${ext}`)
  );

  for (const pattern of patterns) {
    if (existsSync(pattern)) return 100;
  }
  return 0;
}

function scoreCommentDensity(commentLines: number, totalLines: number): number {
  if (totalLines === 0) return 100;
  const ratio = commentLines / totalLines;
  if (ratio > 0.10) return 100;
  if (ratio > 0.05) return 70;
  if (ratio > 0.01) return 40;
  return 10;
}

function scoreFileSize(totalLines: number): number {
  if (totalLines > 500) return 0;
  if (totalLines > 300) return 40;
  if (totalLines > 150) return 70;
  return 100;
}

function getTopIssue(signals: FileScore["signals"]): string {
  if (!signals) return "";
  const issues: [string, number][] = [
    ["function too long", signals.functionLength],
    ["high coupling", signals.coupling],
    ["no tests", signals.testCoverage],
    ["low comments", signals.commentDensity],
    ["file too large", signals.fileSize],
  ];
  issues.sort((a, b) => a[1] - b[1]);
  if (issues[0][1] >= 70) return "✓ AI-ready";
  return issues[0][0];
}

function getFix(issue: string, signals: FileScore["signals"]): string {
  if (!signals) return "";
  if (issue === "✓ AI-ready") return "";
  if (issue === "function too long") return "split into smaller functions";
  if (issue === "high coupling") return `extract shared utils`;
  if (issue === "no tests") return "add test file";
  if (issue === "low comments") return "add doc comments";
  if (issue === "file too large") return "split into modules";
  return "";
}

export function analyzeFile(filePath: string, baseDir: string): FileScore {
  const fullPath = join(baseDir, filePath);
  let code: string;
  try {
    code = readFileSync(fullPath, "utf-8");
  } catch {
    return { path: filePath, score: 0, issues: ["file unreadable"] };
  }

  if (code.trim() === "") {
    return { path: filePath, score: 100, issues: [], signals: { functionLength: 100, coupling: 100, testCoverage: 100, commentDensity: 100, fileSize: 100 } };
  }

  const ext = extname(filePath);
  const isTS = ext === ".ts" || ext === ".tsx";

  const parsed = isTS ? parseTypeScript(code) : parseJavaScript(code);

  const avgFuncLength =
    parsed.functions.length > 0
      ? parsed.functions.reduce((sum, f) => sum + f.lines, 0) / parsed.functions.length
      : 0; // no functions = good

  const funcScore = parsed.functions.length === 0 ? 100 : scoreFunctionLength(avgFuncLength);
  const couplingScore = scoreCoupling(parsed.imports);
  const testScore = scoreTestCoverage(filePath, baseDir);
  const commentScore = scoreCommentDensity(parsed.commentLines, parsed.totalLines);
  const sizeScore = scoreFileSize(parsed.totalLines);

  const overall = Math.round(
    funcScore * 0.3 +
    couplingScore * 0.25 +
    testScore * 0.25 +
    commentScore * 0.1 +
    sizeScore * 0.1
  );

  const signals = {
    functionLength: funcScore,
    coupling: couplingScore,
    testCoverage: testScore,
    commentDensity: commentScore,
    fileSize: sizeScore,
  };

  const issues: string[] = [];
  const topIssue = getTopIssue(signals);
  if (topIssue && topIssue !== "✓ AI-ready") {
    issues.push(topIssue);
    const fix = getFix(topIssue, signals);
    if (fix) issues.push(fix);
  }

  return { path: filePath, score: overall, issues, signals };
}

export function analyzeDirectory(files: string[], baseDir: string): AnalysisResult {
  const fileScores = files.map((f) => analyzeFile(f, baseDir));
  fileScores.sort((a, b) => a.score - b.score);

  const overall =
    fileScores.length > 0
      ? Math.round(fileScores.reduce((sum, f) => sum + f.score, 0) / fileScores.length)
      : 100;

  const recommendations: string[] = [];
  const worst = fileScores.filter((f) => f.score < 40);
  if (worst.length > 0) {
    recommendations.push(`split ${worst[0].path} into smaller files first (biggest win)`);
  }
  for (const f of worst.slice(1, 3)) {
    if (f.issues.length > 0) {
      recommendations.push(`${f.issues[0]} in ${f.path}`);
    }
  }

  if (recommendations.length === 0 && overall < 80) {
    recommendations.push("add test files for untested modules");
  }

  return { files: fileScores, overall, recommendations };
}
