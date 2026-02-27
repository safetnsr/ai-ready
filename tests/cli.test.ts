import { describe, it, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

const CLI_PATH = path.join(__dirname, '..', 'src', 'cli.js');
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-ready-cli-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function run(args: string[], options?: { cwd?: string }): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      cwd: options?.cwd || tmpDir,
      encoding: 'utf-8',
      timeout: 30000,
    });
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: (err.stdout || '') + (err.stderr || ''), exitCode: err.status ?? 1 };
  }
}

describe('cli', () => {
  it('--version prints version and exits 0', () => {
    const { stdout, exitCode } = run(['--version']);
    assert.ok(stdout.trim().includes('1.1.0'));
    assert.equal(exitCode, 0);
  });

  it('--help prints usage and exits 0', () => {
    const { stdout, exitCode } = run(['--help']);
    assert.ok(stdout.includes('usage:'));
    assert.ok(stdout.includes('npx @safetnsr/ai-ready'));
    assert.equal(exitCode, 0);
  });

  it('--json outputs valid JSON', () => {
    // create a simple file to analyze
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x: number = 1;');
    const { stdout, exitCode } = run(['--json']);
    const parsed = JSON.parse(stdout);
    assert.ok(parsed.files);
    assert.ok(parsed.summary);
  });

  it('exits 1 when high-risk file found', () => {
    // file with circular deps won't work in isolation, but >2 global mutations triggers high
    fs.writeFileSync(path.join(tmpDir, 'risky.ts'), `
let a = 1;
let b = 2;
let c = 3;
export function foo() {}
    `.trim());
    const { exitCode } = run(['--json']);
    assert.equal(exitCode, 1);
  });

  it('exits 0 when no high-risk files', () => {
    fs.writeFileSync(path.join(tmpDir, 'clean.ts'), `export const x: number = 1;`);
    // add a test file to avoid medium risk from missing tests
    fs.writeFileSync(path.join(tmpDir, 'clean.test.ts'), `import {} from './clean'; expect(1).toBe(1);`);
    const { exitCode } = run(['--json']);
    assert.equal(exitCode, 0);
  });
});
