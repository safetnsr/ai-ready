import chalk from 'chalk';
import type { FileAnalysis, AnalysisResult } from './analyzer';

function riskBadge(level: string): string {
  switch (level) {
    case 'high': return chalk.red.bold('[HIGH RISK]');
    case 'medium': return chalk.yellow.bold('[MEDIUM RISK]');
    case 'low': return chalk.green.bold('[LOW RISK]');
    default: return `[${level.toUpperCase()}]`;
  }
}

function warn(text: string): string {
  return chalk.yellow('  ⚠ ') + text;
}

function ok(text: string): string {
  return chalk.green('  ✓ ') + text;
}

function hint(text: string): string {
  return chalk.dim('  → ') + chalk.dim(text);
}

function reportFile(file: FileAnalysis): string {
  const lines: string[] = [];

  lines.push(`${file.file}  ${riskBadge(file.risk_level)}`);

  // incoming deps
  if (file.incoming_deps > 0) {
    lines.push(warn(`📥 ${file.incoming_deps} dependent${file.incoming_deps === 1 ? '' : 's'}   → ${file.incoming_deps} file${file.incoming_deps === 1 ? '' : 's'} import this`));
  }

  // circular deps
  if (file.circular_deps.length > 0) {
    lines.push(warn(`circular dep   → ${file.circular_deps.join(', ')}`));
  } else {
    lines.push(ok('no circular deps'));
  }

  // global state
  if (file.global_mutations.length > 0) {
    const muts = file.global_mutations.map(m => `${m.name} (line ${m.line})`).join(', ');
    lines.push(warn(`global state   → ${muts}`));
  }

  // missing types
  if (file.missing_return_types > 0) {
    lines.push(warn(`missing types  → ${file.missing_return_types} exported functions without return type`));
  } else {
    lines.push(ok('types ok'));
  }

  // tests
  if (file.test_coverage.has_test_file) {
    lines.push(ok(`tests          → ${file.test_coverage.assertion_count} assertions`));
  } else {
    lines.push(warn('no test file found'));
  }

  // briefing hints
  if (file.risk_level !== 'low') {
    const parts = file.briefing.split('. ').filter(Boolean);
    for (const part of parts) {
      lines.push(hint(part.endsWith('.') ? part : part + '.'));
    }
  }

  return lines.join('\n');
}

export function reportTerminal(result: AnalysisResult): string {
  const lines: string[] = [];
  const separator = '─'.repeat(40);

  lines.push('');
  lines.push(chalk.bold('ai-ready — pre-session briefing'));
  lines.push(separator);
  lines.push('');

  for (const file of result.files) {
    lines.push(reportFile(file));
    lines.push('');
  }

  lines.push(separator);
  lines.push(result.summary);
  lines.push('');

  return lines.join('\n');
}

export function reportJSON(result: AnalysisResult): string {
  return JSON.stringify(result, null, 2);
}
