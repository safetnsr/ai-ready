import { parse } from '@typescript-eslint/parser';
import * as fs from 'node:fs';
import * as path from 'node:path';
import madge from 'madge';

export interface GlobalMutation {
  name: string;
  line: number;
}

export interface TestCoverage {
  has_test_file: boolean;
  assertion_count: number;
}

export interface FileAnalysis {
  file: string;
  risk_level: 'low' | 'medium' | 'high';
  circular_deps: string[];
  global_mutations: GlobalMutation[];
  missing_return_types: number;
  test_coverage: TestCoverage;
  briefing: string;
}

export interface AnalysisResult {
  files: FileAnalysis[];
  summary: string;
}

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', '.git']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

export function collectFiles(dir: string): string[] {
  const results: string[] = [];

  function walk(current: string) {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          walk(path.join(current, entry.name));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (CODE_EXTENSIONS.has(ext) && !entry.name.endsWith('.d.ts')) {
          results.push(path.join(current, entry.name));
        }
      }
    }
  }

  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    return [dir];
  }
  walk(dir);
  return results;
}

export function detectGlobalMutations(filePath: string): GlobalMutation[] {
  const code = fs.readFileSync(filePath, 'utf-8');
  const mutations: GlobalMutation[] = [];

  try {
    const ast = parse(code, {
      loc: true,
      range: true,
      jsx: true,
      errorOnUnknownASTType: false,
    });

    for (const node of ast.body) {
      // direct top-level variable declaration
      if (node.type === 'VariableDeclaration' && (node.kind === 'let' || node.kind === 'var')) {
        for (const decl of node.declarations) {
          if (decl.id && decl.id.type === 'Identifier') {
            mutations.push({ name: decl.id.name, line: decl.id.loc?.start.line ?? 0 });
          }
        }
      }
      // exported variable declaration: export let x = ...
      if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        const decl = node.declaration;
        if (decl.type === 'VariableDeclaration' && (decl.kind === 'let' || decl.kind === 'var')) {
          for (const d of decl.declarations) {
            if (d.id && d.id.type === 'Identifier') {
              mutations.push({ name: d.id.name, line: d.id.loc?.start.line ?? 0 });
            }
          }
        }
      }
    }
  } catch {
    // parse error — skip
  }

  return mutations;
}

export function detectMissingReturnTypes(filePath: string): number {
  const code = fs.readFileSync(filePath, 'utf-8');
  let count = 0;

  try {
    const ast = parse(code, {
      loc: true,
      range: true,
      jsx: true,
      errorOnUnknownASTType: false,
    });

    for (const node of ast.body) {
      // export function foo() {}
      if (node.type === 'ExportNamedDeclaration' && node.declaration) {
        const decl = node.declaration;
        if (decl.type === 'FunctionDeclaration' && !decl.returnType) {
          count++;
        }
        if (decl.type === 'VariableDeclaration') {
          for (const d of decl.declarations) {
            if (d.init) {
              if (
                (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression') &&
                !d.init.returnType
              ) {
                count++;
              }
            }
          }
        }
      }
      // export default function
      if (node.type === 'ExportDefaultDeclaration' && node.declaration) {
        const decl = node.declaration;
        if (
          (decl.type === 'FunctionDeclaration' || decl.type === 'FunctionExpression' || decl.type === 'ArrowFunctionExpression') &&
          !(decl as any).returnType
        ) {
          count++;
        }
      }
    }
  } catch {
    // parse error — skip
  }

  return count;
}

export function detectTestCoverage(filePath: string): TestCoverage {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath, path.extname(filePath));
  const ext = path.extname(filePath);

  const candidates = [
    path.join(dir, `${base}.test${ext}`),
    path.join(dir, `${base}.spec${ext}`),
    path.join(dir, '__tests__', `${base}${ext}`),
    path.join(dir, `${base}.test.ts`),
    path.join(dir, `${base}.spec.ts`),
    path.join(dir, `${base}.test.js`),
    path.join(dir, `${base}.spec.js`),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const content = fs.readFileSync(candidate, 'utf-8');
      const assertions =
        (content.match(/expect\(/g) || []).length +
        (content.match(/assert\./g) || []).length +
        (content.match(/\.toBe\(/g) || []).length +
        (content.match(/\.toEqual\(/g) || []).length;
      return { has_test_file: true, assertion_count: assertions };
    }
  }

  return { has_test_file: false, assertion_count: 0 };
}

interface MadgeResult {
  circular(): string[][];
}

let madgeCache: Map<string, MadgeResult> = new Map();

export async function detectCircularDeps(filePath: string, projectRoot: string): Promise<string[]> {
  try {
    let result = madgeCache.get(projectRoot);
    if (!result) {
      result = await madge(projectRoot, {
        fileExtensions: ['ts', 'js', 'tsx', 'jsx'],
        excludeRegExp: [/node_modules/, /\.d\.ts$/],
      }) as unknown as MadgeResult;
      madgeCache.set(projectRoot, result);
    }

    const circular = result.circular();
    const relFile = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    // also try without extension
    const relNoExt = relFile.replace(/\.(ts|tsx|js|jsx)$/, '');

    const deps: string[] = [];
    for (const cycle of circular) {
      const match = cycle.some(f => f === relFile || f === relNoExt || f.replace(/\.(ts|tsx|js|jsx)$/, '') === relNoExt);
      if (match) {
        for (const f of cycle) {
          const normalized = f.replace(/\.(ts|tsx|js|jsx)$/, '');
          if (normalized !== relNoExt && !deps.includes(f)) {
            deps.push(f);
          }
        }
      }
    }
    return deps;
  } catch {
    return [];
  }
}

export function clearMadgeCache(): void {
  madgeCache = new Map();
}

export function calculateRisk(analysis: Omit<FileAnalysis, 'risk_level' | 'briefing'>): 'low' | 'medium' | 'high' {
  if (
    analysis.circular_deps.length > 0 ||
    analysis.global_mutations.length > 2 ||
    analysis.missing_return_types > 5
  ) {
    return 'high';
  }
  if (
    analysis.global_mutations.length > 0 ||
    analysis.missing_return_types > 2 ||
    !analysis.test_coverage.has_test_file
  ) {
    return 'medium';
  }
  return 'low';
}

export function generateBriefing(analysis: Omit<FileAnalysis, 'briefing'>): string {
  const parts: string[] = [];

  if (analysis.circular_deps.length > 0) {
    parts.push(`read ${analysis.circular_deps[0]} before touching this file.`);
  }
  if (analysis.global_mutations.length > 0) {
    const names = analysis.global_mutations.map(m => m.name).join(', ');
    parts.push(`avoid ${names} — shared state.`);
  }
  if (analysis.missing_return_types > 0) {
    parts.push(`${analysis.missing_return_types} functions lack return types — type errors may be unpredictable.`);
  }
  if (parts.length === 0) {
    return 'safe to edit.';
  }
  return parts.join(' ');
}

export async function analyzeFiles(files: string[], projectRoot: string): Promise<AnalysisResult> {
  const analyses: FileAnalysis[] = [];

  for (const file of files) {
    const circular_deps = await detectCircularDeps(file, projectRoot);
    const global_mutations = detectGlobalMutations(file);
    const missing_return_types = detectMissingReturnTypes(file);
    const test_coverage = detectTestCoverage(file);

    const partial = {
      file: path.relative(projectRoot, file).replace(/\\/g, '/'),
      circular_deps,
      global_mutations,
      missing_return_types,
      test_coverage,
    };

    const risk_level = calculateRisk(partial);
    const briefing = generateBriefing({ ...partial, risk_level });

    analyses.push({ ...partial, risk_level, briefing });
  }

  // sort: high first, then medium, then low
  const order = { high: 0, medium: 1, low: 2 };
  analyses.sort((a, b) => order[a.risk_level] - order[b.risk_level]);

  const highCount = analyses.filter(a => a.risk_level === 'high').length;
  const medCount = analyses.filter(a => a.risk_level === 'medium').length;
  const lowCount = analyses.filter(a => a.risk_level === 'low').length;

  const parts: string[] = [];
  if (highCount > 0) parts.push(`${highCount} high risk`);
  if (medCount > 0) parts.push(`${medCount} medium`);
  if (lowCount > 0) parts.push(`${lowCount} low`);

  const needsAttention = highCount + medCount;
  const summary = needsAttention > 0
    ? `${parts.join('. ')}. ${needsAttention} file${needsAttention === 1 ? '' : 's'} need${needsAttention === 1 ? 's' : ''} attention before starting your session.`
    : `${analyses.length} file${analyses.length === 1 ? '' : 's'} analyzed. all clear — safe to start.`;

  clearMadgeCache();

  return { files: analyses, summary };
}
