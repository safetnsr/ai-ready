import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  collectFiles,
  detectGlobalMutations,
  detectMissingReturnTypes,
  detectTestCoverage,
  calculateRisk,
  generateBriefing,
} from '../src/analyzer';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ready-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('collectFiles', () => {
  it('finds .ts files and excludes node_modules', () => {
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(tmpDir, 'app.js'), 'const y = 2;');
    fs.mkdirSync(path.join(tmpDir, 'node_modules'));
    fs.writeFileSync(path.join(tmpDir, 'node_modules', 'lib.ts'), 'export const z = 3;');
    fs.writeFileSync(path.join(tmpDir, 'types.d.ts'), 'declare const a: string;');

    const files = collectFiles(tmpDir);
    const names = files.map(f => path.basename(f));

    assert.ok(names.includes('index.ts'));
    assert.ok(names.includes('app.js'));
    assert.ok(!names.includes('lib.ts'));
    assert.ok(!names.includes('types.d.ts'));
  });
});

describe('detectGlobalMutations', () => {
  it('finds module-level let with assignment', () => {
    const file = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(file, `let config = {};\nlet counter = 0;\nconst FIXED = 'hello';`);

    const mutations = detectGlobalMutations(file);
    assert.equal(mutations.length, 2);
    assert.equal(mutations[0].name, 'config');
    assert.equal(mutations[1].name, 'counter');
  });

  it('does NOT flag let inside functions', () => {
    const file = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(file, `function foo() {\n  let x = 1;\n  let y = 2;\n}`);

    const mutations = detectGlobalMutations(file);
    assert.equal(mutations.length, 0);
  });

  it('does NOT flag const (immutable)', () => {
    const file = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(file, `const config = {};\nconst counter = 0;`);

    const mutations = detectGlobalMutations(file);
    assert.equal(mutations.length, 0);
  });
});

describe('detectMissingReturnTypes', () => {
  it('finds exported functions without return type', () => {
    const file = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(file, `export function foo() { return 1; }\nexport function bar() { return 2; }\nexport const baz = () => 3;`);

    const count = detectMissingReturnTypes(file);
    assert.equal(count, 3);
  });

  it('does NOT flag functions with return type', () => {
    const file = path.join(tmpDir, 'test.ts');
    fs.writeFileSync(file, `export function foo(): number { return 1; }\nexport const bar = (): string => 'hello';`);

    const count = detectMissingReturnTypes(file);
    assert.equal(count, 0);
  });
});

describe('detectTestCoverage', () => {
  it('finds matching .test.ts file and counts assertions', () => {
    const file = path.join(tmpDir, 'auth.ts');
    fs.writeFileSync(file, 'export function login() {}');
    const testFile = path.join(tmpDir, 'auth.test.ts');
    fs.writeFileSync(testFile, `
      import { login } from './auth';
      expect(login()).toBe(true);
      expect(login()).toEqual({});
      assert.ok(true);
    `);

    const coverage = detectTestCoverage(file);
    assert.equal(coverage.has_test_file, true);
    assert.ok(coverage.assertion_count >= 3);
  });

  it('returns has_test_file=false when no test file exists', () => {
    const file = path.join(tmpDir, 'auth.ts');
    fs.writeFileSync(file, 'export function login() {}');

    const coverage = detectTestCoverage(file);
    assert.equal(coverage.has_test_file, false);
    assert.equal(coverage.assertion_count, 0);
  });
});

describe('calculateRisk', () => {
  it('returns high when circular deps exist', () => {
    const risk = calculateRisk({
      file: 'test.ts',
      circular_deps: ['other.ts'],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.equal(risk, 'high');
  });

  it('returns medium when 1 global mutation exists', () => {
    const risk = calculateRisk({
      file: 'test.ts',
      circular_deps: [],
      global_mutations: [{ name: 'config', line: 1 }],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.equal(risk, 'medium');
  });

  it('returns low for clean file', () => {
    const risk = calculateRisk({
      file: 'test.ts',
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.equal(risk, 'low');
  });
});

describe('generateBriefing', () => {
  it('includes circular dep file name', () => {
    const briefing = generateBriefing({
      file: 'test.ts',
      risk_level: 'high',
      circular_deps: ['middleware.ts'],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.ok(briefing.includes('middleware.ts'));
  });

  it('names shared state vars', () => {
    const briefing = generateBriefing({
      file: 'test.ts',
      risk_level: 'medium',
      circular_deps: [],
      global_mutations: [{ name: 'sessionStore', line: 10 }, { name: 'config', line: 5 }],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.ok(briefing.includes('sessionStore'));
    assert.ok(briefing.includes('config'));
  });
});
