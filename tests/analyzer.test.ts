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
  detectIncomingDepsDetails,
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

describe('detectIncomingDepsDetails', () => {
  it('returns count and files for incoming deps', async () => {
    // Create a mini project with two files where one imports the other
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
    fs.writeFileSync(path.join(tmpDir, 'utils.ts'), 'export const helper = 1;');
    fs.writeFileSync(path.join(tmpDir, 'main.ts'), 'import { helper } from "./utils";');

    const result = await detectIncomingDepsDetails(path.join(tmpDir, 'utils.ts'), tmpDir);
    assert.equal(typeof result.count, 'number');
    assert.ok(Array.isArray(result.files));
    assert.equal(result.count, result.files.length);
  });

  it('incoming_files contains the correct importer file name', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
    fs.writeFileSync(path.join(tmpDir, 'lib.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(tmpDir, 'consumer.ts'), 'import { x } from "./lib";');

    const result = await detectIncomingDepsDetails(path.join(tmpDir, 'lib.ts'), tmpDir);
    assert.ok(result.files.some(f => f.includes('consumer')));
  });

  it('returns empty when no files import the target', async () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{"name":"test"}');
    fs.writeFileSync(path.join(tmpDir, 'standalone.ts'), 'export const x = 1;');

    const result = await detectIncomingDepsDetails(path.join(tmpDir, 'standalone.ts'), tmpDir);
    assert.equal(result.count, 0);
    assert.deepEqual(result.files, []);
  });
});

describe('calculateRisk', () => {
  it('returns high when circular deps exist', () => {
    const risk = calculateRisk({
      file: 'test.ts',
      incoming_deps: 0,
      incoming_files: [],
      downstream_untested: [],
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
      incoming_deps: 0,
      incoming_files: [],
      downstream_untested: [],
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
      incoming_deps: 0,
      incoming_files: [],
      downstream_untested: [],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.equal(risk, 'low');
  });

  it('returns high when incoming_deps > 5 and no test file', () => {
    const risk = calculateRisk({
      file: 'test.ts',
      incoming_deps: 8,
      incoming_files: [],
      downstream_untested: [],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: false, assertion_count: 0 },
    });
    assert.equal(risk, 'high');
  });

  it('returns medium when incoming_deps > 2 and no test file', () => {
    const risk = calculateRisk({
      file: 'test.ts',
      incoming_deps: 3,
      incoming_files: [],
      downstream_untested: [],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: false, assertion_count: 0 },
    });
    assert.equal(risk, 'medium');
  });

  it('returns low when incoming_deps = 0 and everything clean', () => {
    const risk = calculateRisk({
      file: 'test.ts',
      incoming_deps: 0,
      incoming_files: [],
      downstream_untested: [],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 10 },
    });
    assert.equal(risk, 'low');
  });

  it('returns high when incoming_deps > 3 and downstream_untested > 2', () => {
    const risk = calculateRisk({
      file: 'test.ts',
      incoming_deps: 4,
      incoming_files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      downstream_untested: ['a.ts', 'b.ts', 'c.ts'],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 10 },
    });
    assert.equal(risk, 'high');
  });

  it('does NOT return high when downstream_untested <= 2 even with incoming > 3', () => {
    const risk = calculateRisk({
      file: 'test.ts',
      incoming_deps: 4,
      incoming_files: ['a.ts', 'b.ts', 'c.ts', 'd.ts'],
      downstream_untested: ['a.ts'],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 10 },
    });
    assert.notEqual(risk, 'high');
  });
});

describe('generateBriefing', () => {
  it('includes circular dep file name', () => {
    const briefing = generateBriefing({
      file: 'test.ts',
      risk_level: 'high',
      incoming_deps: 0,
      incoming_files: [],
      downstream_untested: [],
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
      incoming_deps: 0,
      incoming_files: [],
      downstream_untested: [],
      circular_deps: [],
      global_mutations: [{ name: 'sessionStore', line: 10 }, { name: 'config', line: 5 }],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.ok(briefing.includes('sessionStore'));
    assert.ok(briefing.includes('config'));
  });

  it('includes "editing this affects N files" when incoming_deps > 0', () => {
    const briefing = generateBriefing({
      file: 'test.ts',
      risk_level: 'medium',
      incoming_deps: 3,
      incoming_files: ['a.ts', 'b.ts', 'c.ts'],
      downstream_untested: [],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.ok(briefing.includes('editing this affects 3 files'));
  });

  it('includes "editing this affects 1 file" for single dep', () => {
    const briefing = generateBriefing({
      file: 'test.ts',
      risk_level: 'low',
      incoming_deps: 1,
      incoming_files: ['a.ts'],
      downstream_untested: [],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.ok(briefing.includes('editing this affects 1 file'));
  });

  it('includes "write tests before editing" for high-impact untested file', () => {
    const briefing = generateBriefing({
      file: 'test.ts',
      risk_level: 'high',
      incoming_deps: 8,
      incoming_files: [],
      downstream_untested: [],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: false, assertion_count: 0 },
    });
    assert.ok(briefing.includes('write tests before editing'));
  });

  it('returns safe to edit for clean file with no deps', () => {
    const briefing = generateBriefing({
      file: 'test.ts',
      risk_level: 'low',
      incoming_deps: 0,
      incoming_files: [],
      downstream_untested: [],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 10 },
    });
    assert.equal(briefing, 'safe to edit.');
  });

  it('includes "downstream without tests" when downstream_untested is non-empty', () => {
    const briefing = generateBriefing({
      file: 'test.ts',
      risk_level: 'high',
      incoming_deps: 3,
      incoming_files: ['a.ts', 'b.ts', 'c.ts'],
      downstream_untested: ['src/reporter.ts', 'src/cli.ts'],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.ok(briefing.includes('downstream without tests:'));
    assert.ok(briefing.includes('reporter.ts'));
    assert.ok(briefing.includes('changes may break silently'));
  });

  it('truncates downstream_untested list at 3 with +N more', () => {
    const briefing = generateBriefing({
      file: 'test.ts',
      risk_level: 'high',
      incoming_deps: 5,
      incoming_files: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      downstream_untested: ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts'],
      circular_deps: [],
      global_mutations: [],
      missing_return_types: 0,
      test_coverage: { has_test_file: true, assertion_count: 5 },
    });
    assert.ok(briefing.includes('+2 more'));
  });
});
