import { parse } from '@typescript-eslint/parser';
import * as fs from 'node:fs';
import * as path from 'node:path';
import fg from 'fast-glob';
import madge from 'madge';

export interface GlobalMutation {
  name: string;
  line: number;
}

export interface TestCoverage {
  has_test_file: boolean;
  assertion_count: number;
}

export interface IncomingDepsResult {
  count: number;
  files: string[];  // relative paths of files that import this file
}

export interface FileAnalysis {
  file: string;
  risk_level: 'low' | 'medium' | 'high';
  incoming_deps: number;
  incoming_files: string[];         // which files import this file
  downstream_untested: string[];    // incoming files with no test coverage
  circular_deps: string[];
  global_mutations: GlobalMutation[];
  missing_return_types: number;
  test_coverage: TestCoverage;
  briefing: string;
}

export interface AnalysisResult {
  files: FileAnalysis[];
  action_items: string[];   // prioritized list of what to do before starting
  summary: string;
}

export async function collectFiles(dir: string): Promise<string[]> {
  const stat = fs.statSync(dir);
  if (stat.isFile()) return [dir];

  const files = await fg(['**/*.{ts,tsx,js,jsx}'], {
    cwd: dir,
    absolute: true,
    ignore: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.git/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.next/**',
      '**/*.d.ts',
    ],
  });

  return files;
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

  // find project root by walking up to find package.json
  let projectRoot = dir;
  let search = dir;
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(search, 'package.json'))) {
      projectRoot = search;
      break;
    }
    const parent = path.dirname(search);
    if (parent === search) break;
    search = parent;
  }

  const candidates = [
    // sibling: file.test.ts next to file.ts
    path.join(dir, `${base}.test${ext}`),
    path.join(dir, `${base}.spec${ext}`),
    path.join(dir, '__tests__', `${base}${ext}`),
    path.join(dir, `${base}.test.ts`),
    path.join(dir, `${base}.spec.ts`),
    path.join(dir, `${base}.test.js`),
    path.join(dir, `${base}.spec.js`),
    // sibling tests/ directory at same level as src/
    path.join(projectRoot, 'tests', `${base}.test.ts`),
    path.join(projectRoot, 'tests', `${base}.test.js`),
    path.join(projectRoot, 'tests', `${base}.spec.ts`),
    path.join(projectRoot, 'test', `${base}.test.ts`),
    path.join(projectRoot, 'test', `${base}.test.js`),
    // also try relative from src/ → ../tests/
    path.join(dir, '..', 'tests', `${base}.test.ts`),
    path.join(dir, '..', 'tests', `${base}.test.js`),
    path.join(dir, '..', 'test', `${base}.test.ts`),
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
  obj(): Record<string, string[]>;
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

export async function detectIncomingDepsDetails(filePath: string, projectRoot: string): Promise<IncomingDepsResult> {
  try {
    let result = madgeCache.get(projectRoot);
    if (!result) {
      result = await madge(projectRoot, {
        fileExtensions: ['ts', 'js', 'tsx', 'jsx'],
        excludeRegExp: [/node_modules/, /\.d\.ts$/],
      }) as unknown as MadgeResult;
      madgeCache.set(projectRoot, result);
    }

    const obj = (result as any).obj() as Record<string, string[]>;
    const relFile = path.relative(projectRoot, filePath).replace(/\\/g, '/');
    const relNoExt = relFile.replace(/\.(ts|tsx|js|jsx)$/, '');

    const incomingFiles: string[] = [];
    for (const [importer, deps] of Object.entries(obj)) {
      for (const dep of deps) {
        const depNoExt = dep.replace(/\.(ts|tsx|js|jsx)$/, '');
        if (dep === relFile || dep === relNoExt || depNoExt === relNoExt) {
          incomingFiles.push(importer);
          break;
        }
      }
    }

    return { count: incomingFiles.length, files: incomingFiles };
  } catch {
    return { count: 0, files: [] };
  }
}

// backward compat wrapper
export async function detectIncomingDeps(filePath: string, projectRoot: string): Promise<number> {
  const result = await detectIncomingDepsDetails(filePath, projectRoot);
  return result.count;
}

export function clearMadgeCache(): void {
  madgeCache = new Map();
}

export function calculateRisk(analysis: Omit<FileAnalysis, 'risk_level' | 'briefing'>): 'low' | 'medium' | 'high' {
  if (
    analysis.circular_deps.length > 0 ||
    (analysis.incoming_deps > 5 && !analysis.test_coverage.has_test_file) ||
    (analysis.incoming_deps > 3 && analysis.downstream_untested.length > 2) ||
    analysis.global_mutations.length > 2 ||
    analysis.missing_return_types > 5
  ) {
    return 'high';
  }
  if (
    (analysis.incoming_deps > 2 && !analysis.test_coverage.has_test_file) ||
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

  if (analysis.incoming_deps > 0) {
    parts.push(`editing this affects ${analysis.incoming_deps} file${analysis.incoming_deps === 1 ? '' : 's'}.`);
  }
  if (analysis.downstream_untested.length > 0) {
    const names = analysis.downstream_untested.slice(0, 3).map(f => path.basename(f)).join(', ');
    const more = analysis.downstream_untested.length > 3 ? ` +${analysis.downstream_untested.length - 3} more` : '';
    parts.push(`downstream without tests: ${names}${more} — changes may break silently.`);
  }
  if (analysis.circular_deps.length > 0) {
    parts.push(`read ${path.basename(analysis.circular_deps[0])} before touching this file.`);
  }
  if (analysis.global_mutations.length > 0) {
    const names = analysis.global_mutations.map(m => m.name).join(', ');
    parts.push(`avoid ${names} — shared state.`);
  }
  if (analysis.missing_return_types > 0) {
    parts.push(`${analysis.missing_return_types} functions lack return types.`);
  }
  if (analysis.incoming_deps > 5 && analysis.test_coverage.assertion_count < 5) {
    parts.push(`write tests before editing — high impact, low coverage.`);
  }
  if (parts.length === 0) {
    return 'safe to edit.';
  }
  return parts.join(' ');
}

export function generateActionItems(analyses: FileAnalysis[]): string[] {
  const items: string[] = [];

  // 1. downstream untested — highest priority
  for (const a of analyses) {
    if (a.downstream_untested.length > 0 && a.incoming_deps > 0) {
      const untested = a.downstream_untested.slice(0, 2).map(f => path.basename(f)).join(', ');
      const more = a.downstream_untested.length > 2 ? ` +${a.downstream_untested.length - 2} more` : '';
      items.push(`write tests for ${untested}${more} before editing ${path.basename(a.file)} (${a.incoming_deps} files depend on it)`);
    }
  }

  // 2. circular deps — read first
  for (const a of analyses) {
    if (a.circular_deps.length > 0) {
      const dep = path.basename(a.circular_deps[0]);
      items.push(`read ${dep} before touching ${path.basename(a.file)} — circular dependency`);
    }
  }

  // 3. global state with high incoming
  for (const a of analyses) {
    if (a.global_mutations.length > 0 && a.incoming_deps > 2) {
      const names = a.global_mutations.slice(0, 2).map(m => m.name).join(', ');
      items.push(`trace usages of ${names} in ${path.basename(a.file)} — shared by ${a.incoming_deps} files`);
    }
  }

  // dedup and cap at 5 items
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item)) return false;
    seen.add(item);
    return true;
  }).slice(0, 5);
}

export async function analyzeFiles(files: string[], projectRoot: string): Promise<AnalysisResult> {
  const analyses: FileAnalysis[] = [];

  for (const file of files) {
    const circular_deps = await detectCircularDeps(file, projectRoot);
    const incomingResult = await detectIncomingDepsDetails(file, projectRoot);
    const global_mutations = detectGlobalMutations(file);
    const missing_return_types = detectMissingReturnTypes(file);
    const test_coverage = detectTestCoverage(file);

    const partial = {
      file: path.relative(projectRoot, file).replace(/\\/g, '/'),
      incoming_deps: incomingResult.count,
      incoming_files: incomingResult.files,
      downstream_untested: [] as string[],  // computed in second pass
      circular_deps,
      global_mutations,
      missing_return_types,
      test_coverage,
    };

    const risk_level = calculateRisk(partial);
    const briefing = generateBriefing({ ...partial, risk_level });

    analyses.push({ ...partial, risk_level, briefing });
  }

  // second pass: compute downstream_untested
  for (const analysis of analyses) {
    const downstream_untested: string[] = [];
    for (const incomingFile of analysis.incoming_files) {
      const absIncoming = path.resolve(projectRoot, incomingFile);
      // check in already-analyzed files
      const existing = analyses.find(a => a.file === incomingFile);
      if (existing) {
        if (!existing.test_coverage.has_test_file) {
          downstream_untested.push(incomingFile);
        }
      } else {
        // file outside target dir — detect test coverage directly
        if (fs.existsSync(absIncoming)) {
          const coverage = detectTestCoverage(absIncoming);
          if (!coverage.has_test_file) {
            downstream_untested.push(incomingFile);
          }
        }
      }
    }
    analysis.downstream_untested = downstream_untested;
    // recalculate risk now that downstream_untested is known
    analysis.risk_level = calculateRisk(analysis);
    // regenerate briefing
    analysis.briefing = generateBriefing(analysis);
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

  const action_items = generateActionItems(analyses);
  return { files: analyses, action_items, summary };
}
